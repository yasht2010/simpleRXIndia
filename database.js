import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'smartrx.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Users Table (Now with ALL fields)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        password TEXT,
        credits INTEGER DEFAULT 50,
        header_html TEXT,
        custom_keywords TEXT,
        doctor_name TEXT,
        qualification TEXT,
        reg_no TEXT,
        clinic_details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 2. Macros Table
    db.run(`CREATE TABLE IF NOT EXISTS macros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        trigger_phrase TEXT,
        expansion TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    // 3. Admin Seed (Fixed to match new schema)
    db.get("SELECT * FROM users WHERE phone = '9999999999'", (err, row) => {
        if (!row) {
            const hash = bcrypt.hashSync("admin123", 10);
            db.run(`INSERT INTO users (phone, password, credits, doctor_name, header_html) 
                VALUES ('9999999999', '${hash}', 100, 'Dr. Admin', '<h1>Dr. Admin</h1><p>System User</p>')`);
        }
    });
});

// --- USER FUNCTIONS ---

export const getUser = (phone) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE phone = ?", [phone], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
};

export const getUserById = (id) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
};

export const createUser = (phone, password) => {
    return new Promise((resolve, reject) => {
        const hash = bcrypt.hashSync(password, 10);
        const defaultHeader = `<h1>Dr. ${phone}</h1><p>MBBS</p>`;
        db.run("INSERT INTO users (phone, password, header_html, doctor_name) VALUES (?, ?, ?, ?)", 
            [phone, hash, defaultHeader, `Dr. ${phone}`], function(err) {
            if (err) reject(err); else resolve(this.lastID);
        });
    });
};

export const createUserWithDetails = (phone, password, doctorName = "", qualification = "", regNo = "") => {
    return new Promise((resolve, reject) => {
        const hash = bcrypt.hashSync(password, 10);
        const headerHtml = (doctorName || qualification || regNo) ? `<h1>${doctorName || ''}</h1><p>${qualification || ''}</p>` : "";
        db.run(
            "INSERT INTO users (phone, password, header_html, doctor_name, qualification, reg_no) VALUES (?, ?, ?, ?, ?, ?)", 
            [phone, hash, headerHtml, doctorName, qualification, regNo],
            function(err) {
                if (err) reject(err); else resolve(this.lastID);
            }
        );
    });
};

export const updateHeader = (userId, html) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE users SET header_html = ? WHERE id = ?", [html, userId], (err) => {
            if (err) reject(err); else resolve(true);
        });
    });
};

// --- SETTINGS FUNCTIONS (Fixed) ---

export const getSettings = (userId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT header_html, custom_keywords, doctor_name, qualification, reg_no, clinic_details FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) reject(err); 
            else resolve(row);
        });
    });
};

export const saveSettings = (userId, data) => {
    return new Promise((resolve, reject) => {
        const { doctor_name, qualification, reg_no, clinic_details, custom_keywords } = data;
        
        // Update all fields
        db.run(`UPDATE users SET 
            doctor_name=?, qualification=?, reg_no=?, clinic_details=?, custom_keywords=? 
            WHERE id=?`, 
            [doctor_name, qualification, reg_no, clinic_details, custom_keywords, userId], 
            (err) => {
                if (err) reject(err); else resolve(true);
            }
        );
    });
};

// --- WALLET FUNCTIONS ---

export const getCredits = (userId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT credits FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) reject(err); else resolve(row ? row.credits : 0);
        });
    });
};

export const deductCredit = (userId) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1", [userId], function(err) {
            if (err) reject(err);
            else resolve(this.changes > 0); 
        });
    });
};

export const listUsers = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, phone, credits, doctor_name, qualification, clinic_details FROM users", [], (err, rows) => {
            if (err) reject(err); else resolve(rows || []);
        });
    });
};

export const addCredits = (userId, amount) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE users SET credits = credits + ? WHERE id = ?", [amount, userId], function(err) {
            if (err) reject(err); else resolve(this.changes > 0);
        });
    });
};

export const removeUser = (userId) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM users WHERE id = ?", [userId], function(err) {
            if (err) reject(err); else resolve(this.changes > 0);
        });
    });
};

// --- MACRO FUNCTIONS ---

export const getMacros = (userId) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT trigger_phrase, expansion FROM macros WHERE user_id = ?", [userId], (err, rows) => {
            if (err) reject(err); else resolve(rows || []);
        });
    });
};

export const saveMacro = (userId, trigger, expansion) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM macros WHERE user_id = ? AND trigger_phrase = ?", [userId, trigger], () => {
            db.run("INSERT INTO macros (user_id, trigger_phrase, expansion) VALUES (?, ?, ?)", 
                [userId, trigger, expansion], (err) => {
                if (err) reject(err); else resolve(true);
            });
        });
    });
};

export const deleteMacro = (userId, trigger) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM macros WHERE user_id = ? AND trigger_phrase = ?", [userId, trigger], function(err) {
            if (err) reject(err); else resolve(this.changes > 0);
        });
    });
};

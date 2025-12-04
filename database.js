import sqlite3 from 'sqlite3';
import path from 'path';

// Handle Render.com Persistent Disk Path vs Local
const dbPath = process.env.RENDER 
    ? '/var/data/smartrx.db' 
    : './smartrx.db';

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Macros Table
    db.run(`CREATE TABLE IF NOT EXISTS macros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_phrase TEXT UNIQUE,
        expansion TEXT
    )`);

    // 2. Settings Table (Doctor Profile & Keywords)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        doctor_name TEXT,
        qualification TEXT,
        reg_no TEXT,
        clinic_details TEXT,
        custom_keywords TEXT
    )`);

    // Seed Default Settings if empty
    db.get("SELECT count(*) as count FROM settings", (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO settings (id, doctor_name, qualification, reg_no, clinic_details, custom_keywords) 
                VALUES (1, 'Dr. Rajesh Kumar', 'MBBS, MD', 'NMC-12345', 'LifeCare Clinic, MG Road', 'Urimax, Drotin, Niftas, Cital')`);
        }
    });
});

// --- HELPER FUNCTIONS ---

export const getSettings = () => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

export const saveSettings = (data) => {
    return new Promise((resolve, reject) => {
        const { doctor_name, qualification, reg_no, clinic_details, custom_keywords } = data;
        db.run(`UPDATE settings SET doctor_name=?, qualification=?, reg_no=?, clinic_details=?, custom_keywords=? WHERE id=1`, 
            [doctor_name, qualification, reg_no, clinic_details, custom_keywords], 
            (err) => {
                if (err) reject(err);
                else resolve(true);
            }
        );
    });
};

export const getMacros = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT trigger_phrase, expansion FROM macros", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

export const saveMacro = (trigger, expansion) => {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR REPLACE INTO macros (trigger_phrase, expansion) VALUES (?, ?)", 
            [trigger, expansion], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
};
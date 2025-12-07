import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Ensure env vars are loaded even when this module is imported before server bootstrap
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const seedAdminUser = async () => {
    const { data: existing, error: existingError } = await supabase
        .from('users')
        .select('id')
        .eq('phone', '9999999999')
        .maybeSingle();

    // If the table doesn't exist yet (Supabase error PGRST205), just skip quietly.
    if (existingError) {
        if (existingError.code === 'PGRST205') return;
        console.error('Error checking admin seed:', existingError);
        return;
    }
    if (existing) return;

    const hash = bcrypt.hashSync('admin123', 10);
    const { error } = await supabase.from('users').insert({
        phone: '9999999999',
        password: hash,
        credits: 100,
        doctor_name: 'Dr. Admin',
        header_html: '<h1>Dr. Admin</h1><p>System User</p>'
    });

    if (error) console.error('Error seeding admin:', error);
};

seedAdminUser();

// --- USER FUNCTIONS ---

export const getUser = async (phone) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();

    if (error) throw error;
    return data;
};

export const getUserById = async (id) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    return data;
};

export const createUser = async (phone, password) => {
    const hash = bcrypt.hashSync(password, 10);
    const defaultHeader = `<h1>Dr. ${phone}</h1><p>MBBS</p>`;
    const { data, error } = await supabase
        .from('users')
        .insert({
            phone,
            password: hash,
            header_html: defaultHeader,
            doctor_name: `Dr. ${phone}`
        })
        .select('id')
        .maybeSingle();

    if (error) throw error;
    return data?.id;
};

export const createUserWithDetails = async (phone, password, doctorName = "", qualification = "", regNo = "") => {
    const hash = bcrypt.hashSync(password, 10);
    const headerHtml = (doctorName || qualification || regNo) ? `<h1>${doctorName || ''}</h1><p>${qualification || ''}</p>` : "";

    const { data, error } = await supabase
        .from('users')
        .insert({
            phone,
            password: hash,
            header_html: headerHtml,
            doctor_name: doctorName || `Dr. ${phone}`,
            qualification,
            reg_no: regNo
        })
        .select('id')
        .maybeSingle();

    if (error) throw error;
    return data?.id;
};

export const updateHeader = async (userId, html) => {
    const { error } = await supabase
        .from('users')
        .update({ header_html: html })
        .eq('id', userId);

    if (error) throw error;
    return true;
};

// --- SETTINGS FUNCTIONS (Fixed) ---

export const getSettings = async (userId) => {
    const { data, error } = await supabase
        .from('users')
        .select('header_html, custom_keywords, doctor_name, qualification, reg_no, clinic_details')
        .eq('id', userId)
        .maybeSingle();

    if (error) throw error;
    return data;
};

export const saveSettings = async (userId, data) => {
    const { doctor_name, qualification, reg_no, clinic_details, custom_keywords } = data;
    const { error } = await supabase
        .from('users')
        .update({
            doctor_name,
            qualification,
            reg_no,
            clinic_details,
            custom_keywords
        })
        .eq('id', userId);

    if (error) throw error;
    return true;
};

// --- WALLET FUNCTIONS ---

export const getCredits = async (userId) => {
    const { data, error } = await supabase
        .from('users')
        .select('credits')
        .eq('id', userId)
        .maybeSingle();

    if (error) throw error;
    return data?.credits || 0;
};

export const deductCredit = async (userId) => {
    const { data, error } = await supabase
        .rpc('deduct_credit', { user_id_input: userId });

    if (error) throw error;
    return Array.isArray(data) ? data?.[0] : data; // boolean
};

export const listUsers = async () => {
    const { data, error } = await supabase
        .from('users')
        .select('id, phone, credits, doctor_name, qualification, clinic_details');

    if (error) throw error;
    return data || [];
};

export const addCredits = async (userId, amount) => {
    const { error } = await supabase.rpc('add_credits', { user_id_input: userId, amount_input: amount });
    if (error) throw error;
    return true;
};

export const removeUser = async (userId) => {
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) throw error;
    return true;
};

// --- ADMIN PROVIDER SETTINGS ---
const PROVIDER_TABLE = 'provider_settings';

export const getProviderSettings = async () => {
    const { data, error } = await supabase
        .from(PROVIDER_TABLE)
        .select('key, value');
    
    if (error) {
        // Table might not exist yet; return empty overrides instead of crashing
        if (error.code === '42P01' || error.code === 'PGRST116') {
            return {};
        }
        throw error;
    }

    const out = {};
    (data || []).forEach(row => { out[row.key] = row.value; });
    return out;
};

export const saveProviderSettings = async (settings = {}) => {
    const entries = Object.entries(settings).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (!entries.length) return true;
    const payload = entries.map(([key, value]) => ({ key, value: String(value) }));
    const { error } = await supabase
        .from(PROVIDER_TABLE)
        .upsert(payload, { onConflict: 'key' });
    if (error) throw error;
    return true;
};

// --- MACRO FUNCTIONS ---

export const getMacros = async (userId) => {
    const { data, error } = await supabase
        .from('macros')
        .select('trigger_phrase, expansion')
        .eq('user_id', userId);

    if (error) throw error;
    return data || [];
};

export const saveMacro = async (userId, trigger, expansion) => {
    const { error: deleteError } = await supabase
        .from('macros')
        .delete()
        .eq('user_id', userId)
        .eq('trigger_phrase', trigger);
    if (deleteError) throw deleteError;

    const { error } = await supabase
        .from('macros')
        .insert({ user_id: userId, trigger_phrase: trigger, expansion });

    if (error) throw error;
    return true;
};

export const deleteMacro = async (userId, trigger) => {
    const { error } = await supabase
        .from('macros')
        .delete()
        .eq('user_id', userId)
        .eq('trigger_phrase', trigger);

    if (error) throw error;
    return true;
};

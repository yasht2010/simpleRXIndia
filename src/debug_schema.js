import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const checkSchema = async () => {
    console.log("🔍 Checking 'users' table schema...");

    // We can't query information_schema directly with supabase-js easily unless we have rpc or raw query access.
    // However, we can try to inspect a row.
    const { data: users, error } = await supabase.from('users').select('id').limit(1);

    if (error) {
        console.error("❌ Error selecting users:", error);
        return;
    }

    if (users && users.length > 0) {
        const id = users[0].id;
        console.log("🆔 First User ID:", id, "Type:", typeof id);
        if (typeof id === 'string' && id.includes('-')) {
            console.log("✅ ID looks like UUID");
        } else if (typeof id === 'number' || (typeof id === 'string' && !isNaN(id))) {
            console.log("✅ ID looks like BigInt/Integer");
        } else {
            console.log("❓ Unknown ID format");
        }
    } else {
        console.log("⚠️ No users found to check ID type.");
        // Attempt to insert a dummy to check? No, dangerous.
        // We can infer from the error. The invalid function is likely the one matching the wrong type.
    }
};

checkSchema();

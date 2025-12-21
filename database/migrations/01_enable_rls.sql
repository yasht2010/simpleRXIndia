-- Enable Row Level Security (RLS) on all tables
-- This effectively blocks all public/anonymous access via the Supabase API (PostgREST)
-- Your Node.js backend uses the Service Role Key, which BYPASSES RLS, so it will continue to work perfectly.

-- 1. Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_settings ENABLE ROW LEVEL SECURITY;

-- 2. Create "Deny All" policies for public access
-- Since we don't define any "PERMISSIVE" policies for the 'anon' or 'authenticated' roles,
-- default RLS behavior is to DENY everything. 
-- However, creating explicit policies makes it clear in the dashboard.

-- Note: We don't ACTUALLY need to create policies if we want to deny everything. 
-- Enabling RLS without policies = Default Deny.

-- 3. (Optional) If you wanted to allow the backend to work even *without* service role (bad practice but safe fallback),
-- you would add a policy for the service_role, but service_role bypasses anyway.

-- Conclusion: Just running the ALTER TABLE commands above is enough to secure the DB 
-- and silence the dashboard warnings.

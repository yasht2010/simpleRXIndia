-- Fix "Mutable Search Path" Security Warning
-- Vulnerability: Functions running with SECURITY DEFINER (privileged) without a fixed search_path 
-- could be tricked into executing malicious objects from a user-controlled schema.

-- Fix: Explicitly set search_path to 'public' (or appropriate schema) for each function.

CREATE OR REPLACE FUNCTION add_credits(user_id_input uuid, amount_input integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions -- ✅ Secure the search path
AS $$
BEGIN
  UPDATE users
  SET credits = credits + amount_input
  WHERE id = user_id_input;
END;
$$;

CREATE OR REPLACE FUNCTION deduct_credit(user_id_input uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions -- ✅ Secure the search path
AS $$
DECLARE
  current_credits integer;
BEGIN
  SELECT credits INTO current_credits FROM users WHERE id = user_id_input;
  
  IF current_credits > 0 THEN
    UPDATE users SET credits = credits - 1 WHERE id = user_id_input;
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$;

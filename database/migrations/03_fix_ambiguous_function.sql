-- Fix ambiguous function call by removing incorrect UUID version and securing the BigInt version.

-- 1. Drop the incorrect UUID versions created by mistake
DROP FUNCTION IF EXISTS public.deduct_credit(uuid);
DROP FUNCTION IF EXISTS public.add_credits(uuid, integer);

-- 2. Clean up potentially other ambiguous ones if they exist
-- (Just in case, though likely only the above overlap)

-- 3. Re-define the CORRECT functions using BIGINT (since user ID is integer)
-- and apply the security fix (mutable search path).

CREATE OR REPLACE FUNCTION add_credits(user_id_input bigint, amount_input integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE users
  SET credits = credits + amount_input
  WHERE id = user_id_input;
END;
$$;

CREATE OR REPLACE FUNCTION deduct_credit(user_id_input bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

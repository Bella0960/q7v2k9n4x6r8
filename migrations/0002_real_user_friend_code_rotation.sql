-- MAOMAO real-user chat schema v2: one unrevoked friend code per account.
-- Rotation revokes the previous code before inserting the replacement in one D1 batch.
CREATE UNIQUE INDEX IF NOT EXISTS idx_real_user_friend_codes_one_unrevoked_per_account
  ON real_user_friend_codes(account_id)
  WHERE revoked_at IS NULL;

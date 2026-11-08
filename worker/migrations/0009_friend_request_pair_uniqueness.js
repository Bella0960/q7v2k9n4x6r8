/**
 * 0009_friend_request_pair_uniqueness — at most one pending request per pair,
 * regardless of direction. Preserve the earliest pending request when cleaning
 * up legacy opposite-direction duplicates.
 */
export const VERSION = '0009_friend_request_pair_uniqueness';
export const SQL = `
UPDATE friend_requests
SET status = 'rejected',
    updated_at = CASE
      WHEN updated_at < created_at THEN created_at
      ELSE updated_at
    END
WHERE status = 'pending'
  AND id IN (
    SELECT duplicate.id
    FROM friend_requests AS duplicate
    WHERE duplicate.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM friend_requests AS keeper
        WHERE keeper.status = 'pending'
          AND (
            CASE WHEN keeper.requester_id < keeper.recipient_id
              THEN keeper.requester_id ELSE keeper.recipient_id END
          ) = (
            CASE WHEN duplicate.requester_id < duplicate.recipient_id
              THEN duplicate.requester_id ELSE duplicate.recipient_id END
          )
          AND (
            CASE WHEN keeper.requester_id < keeper.recipient_id
              THEN keeper.recipient_id ELSE keeper.requester_id END
          ) = (
            CASE WHEN duplicate.requester_id < duplicate.recipient_id
              THEN duplicate.recipient_id ELSE duplicate.requester_id END
          )
          AND (
            keeper.created_at < duplicate.created_at
            OR (
              keeper.created_at = duplicate.created_at
              AND keeper.id < duplicate.id
            )
          )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_unordered_pair
  ON friend_requests (
    CASE WHEN requester_id < recipient_id THEN requester_id ELSE recipient_id END,
    CASE WHEN requester_id < recipient_id THEN recipient_id ELSE requester_id END
  )
  WHERE status = 'pending';
`;

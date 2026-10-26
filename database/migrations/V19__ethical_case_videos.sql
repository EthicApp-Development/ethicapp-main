-- YouTube videos owned by a case (#781, epic #779), as complementary material
-- for the decisions its questions ask for.
--
-- A row holds only the case, the video's place in the case's list and its
-- 11-character YouTube id. No YouTube metadata is stored: EthicApp fetches the
-- title, description and duration lazily and caches them in the cache Redis
-- with a TTL, which keeps it within YouTube's 30-day storage limit.
--
-- position starts at 1 and is unique per case, so the list has one order. A
-- video appears once per case. Rows go with their case.

CREATE TABLE IF NOT EXISTS ethical_case_videos (
    id bigserial PRIMARY KEY,
    case_id integer NOT NULL REFERENCES ethical_cases (id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    youtube_video_id text NOT NULL CHECK (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT ethical_case_videos_case_video_key UNIQUE (case_id, youtube_video_id),
    CONSTRAINT ethical_case_videos_case_position_key UNIQUE (case_id, position)
);

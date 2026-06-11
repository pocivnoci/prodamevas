-- Native AI design engine: design briefs + visual QA observability
-- design_brief: full DesignBrief JSON produced by the AI Designer (anti-repetition source)
-- qa_status:    outcome of the native-image vision QA loop
--               'pass' | 'retry_pass' | 'fallback' | 'overlay'

alter table ig_posts add column if not exists design_brief jsonb;
alter table ig_generation_log add column if not exists qa_status text;

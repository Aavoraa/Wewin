-- Desktop Transaction menu (Q-071): the processes it lists that Wewin did not have yet. Each runs
-- through job work (rate quotation = rate contract, delivery = outward D.C., inward / return =
-- inward D.C., job close = closing the outward D.C.). Kilo stage; Knitting, (fabric) Dyeing and
-- Compacting already exist.
INSERT INTO processes (id, code, name, stage, default_return_days, updated_at) VALUES
  (gen_random_uuid(), 'YARN_DYEING', 'Yarn dyeing', 'KG', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'YARN_TWISTING', 'Yarn twisting', 'KG', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'YARN_OTHER', 'Yarn other process', 'KG', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GREY_PROCESS', 'Grey process', 'KG', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FABRIC_PRINTING', 'Fabric printing', 'KG', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FABRIC_OTHER', 'Fabric other process', 'KG', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FABRIC_REPROCESS', 'Fabric reprocess', 'KG', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FABRIC_TO_YARN', 'Fabric to yarn', 'KG', 15, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;

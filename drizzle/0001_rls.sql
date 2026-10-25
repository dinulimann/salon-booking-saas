-- Tenant isolation, double-booking protection and app privileges.
--
-- The app connects as salon_app and runs every tenant query inside a
-- transaction that sets app.tenant_id (src/db/index.ts: withTenant). The
-- policies below make a query without that setting see nothing, and a query
-- for another salon see nothing, even if the code forgets a WHERE clause.

CREATE OR REPLACE FUNCTION current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships', 'staff', 'services', 'staff_services', 'working_hours', 'customers',
                           'bookings', 'invoice_counters', 'invoices', 'payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) '
                   'WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Salons are public (the booking page finds them by slug) but only the
-- current salon can be changed.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY tenants_create ON tenants FOR INSERT WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY tenants_update ON tenants FOR UPDATE USING (id = current_tenant()) WITH CHECK (id = current_tenant());
--> statement-breakpoint

-- Payment notifications may arrive for an order we do not know (tenant NULL).
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_events_read ON payment_events FOR SELECT USING (tenant_id = current_tenant());
--> statement-breakpoint
CREATE POLICY payment_events_write ON payment_events FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_tenant());
--> statement-breakpoint

-- No two active bookings of one staff member overlap. Expired holds are
-- cancelled by the app before it inserts (src/lib/booking.ts).
ALTER TABLE bookings ADD COLUMN during tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED;
--> statement-breakpoint
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (staff_id WITH =, during WITH &&) WHERE (status IN ('pending_payment', 'confirmed'));
--> statement-breakpoint

-- Lookups that must work before the tenant is known. SECURITY DEFINER runs
-- them as the table owner; they return ids only.
CREATE OR REPLACE FUNCTION tenant_of_order(p_order_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT tenant_id FROM payments WHERE order_id = p_order_id $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenants_of_user(p_user_id text) RETURNS TABLE (tenant_id uuid, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT tenant_id, role FROM memberships WHERE user_id = p_user_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_of_order(text), tenants_of_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_of_order(text), tenants_of_user(text), current_tenant() TO salon_app;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO salon_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app;
--> statement-breakpoint
-- The audit trail can only grow.
REVOKE UPDATE, DELETE ON payment_events FROM salon_app;

INSERT INTO public.user_roles (user_id, role) VALUES ('4974847b-db2c-44d3-adc9-4523b1c7ba1b', 'owner') ON CONFLICT DO NOTHING;
DROP TRIGGER IF EXISTS bootstrap_owner_trigger ON auth.users;
CREATE TRIGGER bootstrap_owner_trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.bootstrap_owner();
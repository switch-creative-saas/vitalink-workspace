-- Growth advertises "VitaMind AI clinical decision support"; give it the module VitaMind Dx checks.
update public.plans set modules = array_append(modules, 'vitamind-ai') where id = 'growth' and not ('vitamind-ai' = any (modules));

-- The stamp trigger draws order numbers from private.lab_order_serial, which
-- signed-in users cannot read directly.
alter function private.lab_order_stamp() security definer;

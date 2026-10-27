-- 정산하기 한 번에 여러 지출을 등록할 때 쓰는 RPC.
-- create_expense 를 건마다 호출하되 함수 하나 = 트랜잭션 하나라서, 한 건이라도 실패하면 전부 취소된다.
create or replace function public.create_expense_batch(payload jsonb)
returns bigint[]
language plpgsql
as $$
declare
  v_item jsonb;
  v_ids bigint[] := '{}';
begin
  if jsonb_typeof(payload -> 'expenses') is distinct from 'array'
     or jsonb_array_length(payload -> 'expenses') = 0 then
    raise exception 'at least one expense is required';
  end if;

  if jsonb_array_length(payload -> 'expenses') > 20 then
    raise exception 'too many expenses (max 20)';
  end if;

  for v_item in select * from jsonb_array_elements(payload -> 'expenses') loop
    v_ids := v_ids || public.create_expense(v_item);
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.create_expense_batch(jsonb) from public, anon, authenticated;
grant execute on function public.create_expense_batch(jsonb) to service_role;

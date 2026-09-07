-- 티끌 기기 간 동기화용 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요.
-- 테이블은 직접 접근을 막고, 동기화 코드를 아는 사람만 함수로 읽고 쓸 수 있습니다.

create table if not exists public.docs (
  code       text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.docs enable row level security;
revoke all on public.docs from anon, authenticated;

-- 코드 정확히 일치할 때만 한 건 반환 (목록 조회 불가)
create or replace function public.get_doc(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if p_code is null or length(p_code) < 24 then
    raise exception '동기화 코드가 너무 짧습니다';
  end if;
  select data into d from public.docs where code = p_code;
  return d;
end; $$;

create or replace function public.put_doc(p_code text, p_data jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  if p_code is null or length(p_code) < 24 then
    raise exception '동기화 코드가 너무 짧습니다';
  end if;
  insert into public.docs (code, data, updated_at)
       values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end; $$;

revoke all on function public.get_doc(text) from public;
revoke all on function public.put_doc(text, jsonb) from public;
grant execute on function public.get_doc(text) to anon, authenticated;
grant execute on function public.put_doc(text, jsonb) to anon, authenticated;

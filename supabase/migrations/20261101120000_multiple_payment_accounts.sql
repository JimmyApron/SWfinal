-- 내 계좌를 여러 개 저장하고, 그중 하나를 기본 계좌로 지정할 수 있게 한다.
-- 기존에는 회원당 1행(userid 가 PK)이었다. 기존 계좌는 그대로 기본 계좌가 된다.

alter table public.user_payment_accounts
  drop constraint if exists user_payment_accounts_pkey;

alter table public.user_payment_accounts
  add column if not exists id bigint generated always as identity,
  add column if not exists label text,
  add column if not exists isdefault boolean not null default false;

alter table public.user_payment_accounts
  add primary key (id);

-- 이미 저장돼 있던 계좌는 기본 계좌로
update public.user_payment_accounts
   set isdefault = true,
       label = coalesce(label, nullif(bankname, ''), '내 계좌')
 where isdefault = false;

create index if not exists user_payment_accounts_userid_idx
  on public.user_payment_accounts (userid);

-- 기본 계좌는 회원당 하나만
create unique index if not exists user_payment_accounts_one_default_idx
  on public.user_payment_accounts (userid)
  where isdefault;

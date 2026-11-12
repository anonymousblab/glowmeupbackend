create table if not exists public.app_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);

create table if not exists public.app_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  height_cm integer check (height_cm between 100 and 250),
  questionnaire jsonb,
  privacy_accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.app_profiles add column if not exists questionnaire jsonb;

create table if not exists public.fashion_products (
  product_id text primary key,
  product_group text not null check (product_group in ('tops', 'bottoms')),
  subcategory text not null,
  product_name text not null,
  image_path text not null,
  primary_color text not null,
  secondary_colors jsonb not null default '[]'::jsonb,
  color_family text not null,
  color_value text not null,
  color_chroma text not null,
  color_contrast text not null,
  pattern_tags jsonb not null default '[]'::jsonb,
  apparent_silhouette text,
  garment_length text,
  sleeve_length text,
  neckline text,
  waist_rise text,
  coverage_tags jsonb not null default '[]'::jsonb,
  style_tags jsonb not null default '[]'::jsonb,
  occasion_tags jsonb not null default '[]'::jsonb,
  formality text not null,
  visible_details text not null,
  visual_confidence text not null check (visual_confidence in ('high', 'medium', 'low')),
  uncertainty_notes text,
  review_priority text not null,
  review_status text not null,
  source_image_url text,
  source_repository text,
  source_image_sha256 text,
  source_rights_status text,
  image_resolution_px text,
  image_origin text,
  annotation_schema_version text not null,
  evidence_policy text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fashion_products_group_idx on public.fashion_products(product_group);
create index if not exists fashion_products_formality_idx on public.fashion_products(formality);
create index if not exists fashion_products_style_tags_idx on public.fashion_products using gin(style_tags);
create index if not exists fashion_products_occasion_tags_idx on public.fashion_products using gin(occasion_tags);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_profiles enable row level security;
alter table public.fashion_products enable row level security;

revoke all on public.app_users, public.app_sessions, public.app_profiles, public.fashion_products from anon, authenticated;

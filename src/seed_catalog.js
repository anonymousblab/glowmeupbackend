import { readFile } from 'node:fs/promises';
import { readConfig } from './config.js';
import { createPool } from './database.js';

const dataset = JSON.parse(
  await readFile(new URL('./data/fashion_dataset.json', import.meta.url), 'utf8'),
);
const pool = createPool(readConfig().databaseUrl);

const sql = `
  insert into public.fashion_products (
    product_id, product_group, subcategory, product_name, image_path,
    primary_color, secondary_colors, color_family, color_value, color_chroma,
    color_contrast, pattern_tags, apparent_silhouette, garment_length,
    sleeve_length, neckline, waist_rise, coverage_tags, style_tags,
    occasion_tags, formality, visible_details, visual_confidence,
    uncertainty_notes, review_priority, review_status, source_image_url,
    source_repository, source_image_sha256, source_rights_status,
    image_resolution_px, image_origin, annotation_schema_version, evidence_policy
  )
  select
    product_id, "group", subcategory, product_name_source_title, image_path,
    primary_color, secondary_colors, color_family, color_value, color_chroma,
    color_contrast, pattern_tags, apparent_silhouette, garment_length,
    sleeve_length, neckline, waist_rise, coverage_tags, style_tags,
    occasion_tags, formality, visible_details, visual_confidence,
    uncertainty_notes, review_priority, review_status, source_image_url,
    source_repository, source_image_sha256, source_rights_status,
    image_resolution_px, image_origin, annotation_schema_version, evidence_policy
  from jsonb_to_recordset($1::jsonb) as item(
    product_id text, "group" text, subcategory text,
    product_name_source_title text, image_path text, primary_color text,
    secondary_colors jsonb, color_family text, color_value text,
    color_chroma text, color_contrast text, pattern_tags jsonb,
    apparent_silhouette text, garment_length text, sleeve_length text,
    neckline text, waist_rise text, coverage_tags jsonb, style_tags jsonb,
    occasion_tags jsonb, formality text, visible_details text,
    visual_confidence text, uncertainty_notes text, review_priority text,
    review_status text, source_image_url text, source_repository text,
    source_image_sha256 text, source_rights_status text,
    image_resolution_px text, image_origin text,
    annotation_schema_version text, evidence_policy text
  )
  on conflict (product_id) do update set
    product_group = excluded.product_group,
    subcategory = excluded.subcategory,
    product_name = excluded.product_name,
    image_path = excluded.image_path,
    primary_color = excluded.primary_color,
    secondary_colors = excluded.secondary_colors,
    color_family = excluded.color_family,
    color_value = excluded.color_value,
    color_chroma = excluded.color_chroma,
    color_contrast = excluded.color_contrast,
    pattern_tags = excluded.pattern_tags,
    apparent_silhouette = excluded.apparent_silhouette,
    garment_length = excluded.garment_length,
    sleeve_length = excluded.sleeve_length,
    neckline = excluded.neckline,
    waist_rise = excluded.waist_rise,
    coverage_tags = excluded.coverage_tags,
    style_tags = excluded.style_tags,
    occasion_tags = excluded.occasion_tags,
    formality = excluded.formality,
    visible_details = excluded.visible_details,
    visual_confidence = excluded.visual_confidence,
    uncertainty_notes = excluded.uncertainty_notes,
    review_priority = excluded.review_priority,
    review_status = excluded.review_status,
    source_image_url = excluded.source_image_url,
    source_repository = excluded.source_repository,
    source_image_sha256 = excluded.source_image_sha256,
    source_rights_status = excluded.source_rights_status,
    image_resolution_px = excluded.image_resolution_px,
    image_origin = excluded.image_origin,
    annotation_schema_version = excluded.annotation_schema_version,
    evidence_policy = excluded.evidence_policy,
    is_active = true,
    updated_at = now()
`;

try {
  await pool.query('begin');
  const result = await pool.query(sql, [JSON.stringify(dataset.annotations)]);
  await pool.query('commit');
  console.log(`Catalog seeded: ${result.rowCount} products.`);
} catch (error) {
  await pool.query('rollback');
  throw error;
} finally {
  await pool.end();
}

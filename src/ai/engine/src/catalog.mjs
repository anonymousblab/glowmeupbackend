import { ensure,copy } from './errors.mjs';
import { TAXONOMY as T } from './taxonomy.mjs';
export function validateCatalog(items) {
  ensure(Array.isArray(items)&&items.length<=10000,'INVALID_CATALOG','Katalog harus berupa array terbatas.');
  ensure(new Set(items.map(i=>i?.product_id)).size===items.length,'INVALID_CATALOG','ID produk duplikat.');
  for(const item of items) {
    ensure(item&&/^GM\d{3}$/.test(item.product_id)&&['tops','bottoms'].includes(item.group),'INVALID_CATALOG','ID/group tidak valid.');
    for(const [key,values] of [['style_tags',T.style],['occasion_tags',T.occasion],['pattern_tags',T.pattern],['coverage_tags',T.coverage]])
      ensure(Array.isArray(item[key])&&item[key].every(v=>values.includes(v))&&new Set(item[key]).size===item[key].length,'INVALID_CATALOG',`Tag ${key} tidak valid.`);
    ensure(item.color_family===null||T.color.includes(item.color_family),'INVALID_CATALOG','Color family tidak valid.');
    ensure(item.apparent_silhouette===null||item.apparent_silhouette==='unknown'||T.silhouette.includes(item.apparent_silhouette),'INVALID_CATALOG','Silhouette tidak valid.');
    ensure(['needs_human_review','approved'].includes(item.review_status),'INVALID_CATALOG','Review status tidak valid.');
    ensure(['third_party_image_rights_unverified','cleared_for_public_use'].includes(item.source_rights_status),'INVALID_CATALOG','Rights status tidak valid.');
    ensure(typeof item.subcategory==='string'&&item.subcategory.length<=100,'INVALID_CATALOG','Subcategory tidak valid.');
    ensure(item.annotation_schema_version==='working_v0.2','INVALID_CATALOG','Versi anotasi tidak didukung.');
  }
  return copy(items);
}

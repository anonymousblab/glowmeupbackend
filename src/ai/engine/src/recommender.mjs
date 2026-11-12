import { ensure, copy } from './errors.mjs';
import { validateProfile } from './contracts.mjs';
import { confirmedContext } from './know-me.mjs';
import { TAXONOMY as T } from './taxonomy.mjs';
import { validateCatalog } from './catalog.mjs';

export const WEIGHTS=Object.freeze({style:.35,occasion:.25,color:.20,silhouette:.10,pattern:.10});
const tags=x=>Array.isArray(x)?x:[];
export function rankProducts(profile,items,{group=null,occasion=null,limit=10,demoOnly=false}={}) {
  validateProfile(profile);
  items=validateCatalog(items);
  ensure(group===null||['tops','bottoms'].includes(group));
  ensure(occasion===null||T.occasion.includes(occasion));
  ensure(Number.isInteger(limit)&&limit>=0&&limit<=50,'INVALID_LIMIT','Limit harus integer 0–50.');
  ensure(typeof demoOnly==='boolean');
  ensure(new Set(items.map(p=>p.product_id)).size===items.length,'INVALID_CATALOG','ID katalog duplikat.');
  const p=confirmedContext(profile);
  const styles=[p.style_profile.primary,p.style_profile.secondary].filter(Boolean);
  const occasions=occasion?[occasion]:p.lifestyle.occasions;
  const wanted={style:styles,occasion:occasions,color:p.color_profile.liked_color_families,silhouette:p.body_profile.preferred_silhouettes,pattern:p.preferences.liked_patterns};
  // Explicit restrictions are always enforced, even if profile provenance is incomplete.
  const required=profile.preferences.coverage_requirements;
  const results=[];
  for(const item of items) {
    ensure(item&&/^GM\d{3}$/.test(item.product_id)&&['tops','bottoms'].includes(item.group),'INVALID_CATALOG','Record katalog tidak valid.');
    if(group&&item.group!==group)continue;
    if(!demoOnly&&(item.review_status!=='approved'||item.source_rights_status!=='cleared_for_public_use'))continue;
    if(profile.color_profile.avoided_color_families.includes(item.color_family))continue;
    if(tags(item.pattern_tags).some(v=>profile.preferences.avoided_patterns.includes(v)))continue;
    if(tags(item.style_tags).some(v=>profile.preferences.disliked_styles.includes(v)))continue;
    const applies=required.filter(v=>item.group==='tops'?['shoulders_covered','arms_covered','high_neckline'].includes(v):['legs_covered','ankle_length'].includes(v));
    if(applies.some(v=>!tags(item.coverage_tags).includes(v)))continue;
    // Conservative policy: do not promise full coverage through transparent sleeves/openwork or high slits.
    if(applies.length && tags(item.coverage_tags).some(v=>item.group==='tops'?['sheer_or_openwork','openwork','sheer_sleeves','chest_cutout'].includes(v):v==='high_slit'))continue;
    const available={style:tags(item.style_tags),occasion:tags(item.occasion_tags),color:item.color_family?[item.color_family]:[],silhouette:item.apparent_silhouette&&item.apparent_silhouette!=='unknown'?[item.apparent_silhouette]:[],pattern:tags(item.pattern_tags)};
    const components={},matches=[];
    for(const [signal,wants] of Object.entries(wanted)) {
      const have=available[signal];
      if(!wants.length||!have.length){components[signal]=null;continue;}
      const matched=wants.filter(v=>have.includes(v));
      components[signal]=signal==='style'?(have.includes(wants[0])?1:(wants[1]&&have.includes(wants[1]) ? 0.6 : 0)):(matched.length?1:0);
      for(const value of matched)matches.push({signal,value});
    }
    const active=Object.entries(components).filter(([,v])=>v!==null);
    const sum=active.reduce((n,[key])=>n+WEIGHTS[key],0);
    const score=sum?active.reduce((n,[key,v])=>n+WEIGHTS[key]*v,0)/sum:0;
    results.push({product_id:item.product_id,group:item.group,subcategory:item.subcategory,score:Math.round(score*10000)/10000,components,matched_tags:matches,
      reason:matches.length?`Sesuai preferensi: ${matches.slice(0,3).map(m=>`${m.signal} ${m.value}`).join(', ')}.`:'Belum ada kecocokan preferensi eksplisit; kandidat dari katalog.',
      profile_version:profile.profile_version,review_status:item.review_status,source_rights_status:item.source_rights_status,
      visual_confidence:item.visual_confidence,image_path:item.image_path,
      safety_note:demoOnly?'DEMO_ONLY_UNVERIFIED_RIGHTS_AND_LABELS':null});
  }
  return copy(results.sort((a,b)=>b.score-a.score||a.product_id.localeCompare(b.product_id)).slice(0,limit));
}

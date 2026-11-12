import { copy } from '../src/errors.mjs';
// Local, principal-scoped RAM history. Images and obsolete profiles are never retained.
export class ConversationHistory{
  #entries=new Map();
  constructor({maxTurns=4,maxChars=6000}={}){this.maxTurns=maxTurns;this.maxChars=maxChars;}
  get(id,version,allowedIds){
    const entry=this.#entries.get(id);if(!entry||entry.version!==version)return [];
    return copy(entry.turns.filter(turn=>{const ids=(turn.user+'\n'+turn.assistant).match(/\bGM\d+\b/gi)??[];return ids.every(value=>allowedIds.includes(value.toUpperCase()));}));
  }
  append(id,version,user,assistant){
    const entry=this.#entries.get(id),turns=entry?.version===version?copy(entry.turns):[];
    turns.push({user,assistant});
    while(turns.length>this.maxTurns||JSON.stringify(turns).length>this.maxChars)turns.shift();
    this.#entries.set(id,{version,turns});
  }
  delete(id){this.#entries.delete(id);}
}

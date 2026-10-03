import { parseHTML } from 'linkedom';
export const sessions=[
 {id:'regular',slug:'fall-regular-2026',label:'Fall 2026 · Regular session',year:2026,season:'fall'},
 {id:'7w',slug:'fall-7w1-2026',label:'Fall 2026 · First 7-week session',year:2026,season:'fall'},
 {id:'8w',slug:'fall-8w2-2026',label:'Fall 2026 · Second 8-week session',year:2026,season:'fall'},
 {id:'winter',slug:'winter-2027',label:'Winter 2027',year:2027,season:'winter'},
 {id:'spring',slug:'spring-regular-2027',label:'Spring 2027 · Regular session',year:2027,season:'spring'}
];
export const sourceFor=s=>'https://www.bmcc.cuny.edu/academics/academic-calendar/'+s.slug+'/';
export const localParts=(now=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
export function localDate(now=new Date()){const p=localParts(now);return `${p.year}-${p.month}-${p.day}`;}
export const addDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const text=el=>(el?.textContent||'').replace(/\s+/g,' ').trim();
function iso(month,day,s){const m=months.indexOf(month.toLowerCase())+1;if(!m)throw Error('Unrecognized month');let y=s.year;if(s.season==='fall'&&m<3)y++;if(s.season==='winter'&&m===12)y--;const result=`${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;if(new Date(result+'T12:00:00Z').toISOString().slice(0,10)!==result)throw Error('Invalid calendar date');return result;}
export function dateRange(raw,s){const value=raw.replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();const m=value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?$/);if(!m)throw Error('Unrecognized date range: '+value);const start=iso(m[1],+m[2],s);const end=m[4]?iso(m[3]||m[1],+m[4],s):start;if(end<start||Date.parse(end)-Date.parse(start)>60*86400000)throw Error('Invalid range');return {date:start,end};}
export function parseCalendar(html,s){
 const {document}=parseHTML(html);const heading=text(document.querySelector('h1')).toLowerCase();const expected=s.slug.replaceAll('-',' ');if(!heading.includes(expected))throw Error('Unexpected calendar page');
 const tables=[...document.querySelectorAll('table.tablepress')];if(!tables.length)throw Error('Calendar table missing');const events=[];let rows=0;
 for(const table of tables)for(const tr of table.querySelectorAll('tr')){const cells=[...tr.querySelectorAll('td')];if(cells.length<3)continue;rows++;const detail=text(cells[2]);let type;if(/college\s+closed/i.test(detail))type='closed';else if(/classes\s+follow/i.test(detail))type='schedule';else if(/no\s+classes/i.test(detail))type='no-class';else continue;
 const range=dateRange(text(cells[0]),s);const title=type==='closed'?'College closed':type==='no-class'?'No classes scheduled':detail;events.push({...range,type,title,detail,source:sourceFor(s)});
 }
 if(rows<5||events.length<1)throw Error('Calendar structure could not be verified');
 const unique=[...new Map(events.map(e=>[`${e.date}:${e.end}:${e.type}`,e])).values()];return unique.sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type));
}
export function dayEvents(events,day){return events.filter(e=>e.date<=day&&e.end>=day);}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function notificationFor(events,day,correction=false){const summary=events.length?events.map(e=>e.title).join('; '):'Previously announced calendar exception removed';return{title:correction?'BMCC calendar update':'BMCC · Tomorrow’s calendar',body:`${day}: ${summary}. Open to verify the official calendar.`,tag:'bmcc-'+day,url:'/',eventDate:day};}

export interface LocalParts { year:number; month:number; day:number; hour:number; minute:number; second:number; weekday:string }
export interface PollScheduleOccurrence {
  eventDate:string; eventMonthDay:string; eventKey:string; createAt:Date; closeAt:Date;
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone:string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23', weekday:'short' });
    formatters.set(zone, f);
  }
  return f;
}
export function localParts(date:Date, zone:string): LocalParts {
  const p = Object.fromEntries(formatter(zone).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return { year:Number(p.year), month:Number(p.month), day:Number(p.day), hour:Number(p.hour), minute:Number(p.minute), second:Number(p.second), weekday:p.weekday ?? '' };
}
export function zonedDateToUtc(year:number, month:number, day:number, hour:number, minute:number, zone:string): Date {
  const desired = Date.UTC(year, month-1, day, hour, minute, 0);
  let guess = desired;
  for (let i=0;i<4;i++) {
    const p = localParts(new Date(guess), zone);
    const represented = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const adjustment = desired - represented;
    if (adjustment === 0) break;
    guess += adjustment;
  }
  return new Date(guess);
}
function ymd(d:Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
export function currentWeekSchedule(now:Date, zone:string) {
  const p = localParts(now, zone);
  const localAnchor = new Date(Date.UTC(p.year,p.month-1,p.day));
  const weekday = localAnchor.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1-weekday;
  const monday = new Date(localAnchor.getTime()+mondayOffset*86400000);
  const wednesday = new Date(monday.getTime()+2*86400000);
  const [y,m,d] = [wednesday.getUTCFullYear(),wednesday.getUTCMonth()+1,wednesday.getUTCDate()];
  return {
    eventDate: ymd(wednesday),
    eventMonthDay: `${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')}`,
    eventKey: ymd(wednesday),
    createAt: zonedDateToUtc(monday.getUTCFullYear(),monday.getUTCMonth()+1,monday.getUTCDate(),12,0,zone),
    closeAt: zonedDateToUtc(y,m,d,11,55,zone)
  };
}

interface ParsedLocalStamp { year:number;month:number;day:number;hour:number;minute:number }
function parsedLocalStamp(stamp:string):ParsedLocalStamp {
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp);
  if(!match) throw new Error('Invalid local date/time');
  return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]),minute:Number(match[5])};
}
function stamp(parts:ParsedLocalStamp):string {
  return `${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}T${String(parts.hour).padStart(2,'0')}:${String(parts.minute).padStart(2,'0')}`;
}
export function localDateTime(dateText:string,timeText:string,zone:string):{stamp:string;utc:Date} {
  const dateMatch=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
  const timeMatch=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeText);
  if(!dateMatch || !timeMatch) throw new Error('Використайте формат ДД.ММ.РРРР ГГ:ХХ.');
  const parts={year:Number(dateMatch[3]),month:Number(dateMatch[2]),day:Number(dateMatch[1]),hour:Number(timeMatch[1]),minute:Number(timeMatch[2])};
  const utc=zonedDateToUtc(parts.year,parts.month,parts.day,parts.hour,parts.minute,zone);
  const roundTrip=localParts(utc,zone);
  if(roundTrip.year!==parts.year || roundTrip.month!==parts.month || roundTrip.day!==parts.day || roundTrip.hour!==parts.hour || roundTrip.minute!==parts.minute) throw new Error('Такої локальної дати або часу не існує.');
  return {stamp:stamp(parts),utc};
}
export function localDateText(date:Date,zone:string):string {
  const p=localParts(date,zone);
  return `${String(p.day).padStart(2,'0')}.${String(p.month).padStart(2,'0')}.${p.year}`;
}
function atWeek(stampValue:string,weeks:number,zone:string):Date {
  const p=parsedLocalStamp(stampValue);
  const calendar=new Date(Date.UTC(p.year,p.month-1,p.day+weeks*7));
  return zonedDateToUtc(calendar.getUTCFullYear(),calendar.getUTCMonth()+1,calendar.getUTCDate(),p.hour,p.minute,zone);
}
export function weeklySchedule(now:Date,createLocal:string,closeLocal:string,zone:string):PollScheduleOccurrence {
  const baseCreate=parsedLocalStamp(createLocal); const baseClose=parsedLocalStamp(closeLocal);
  const baseCreateAt=atWeek(createLocal,0,zone); const baseCloseAt=atWeek(closeLocal,0,zone);
  const duration=baseCloseAt.getTime()-baseCreateAt.getTime();
  if(duration<=0 || duration>7*86400000) throw new Error('Закриття має бути після старту, але не пізніше ніж через 7 днів.');
  const n=localParts(now,zone);
  const dayDifference=Math.floor((Date.UTC(n.year,n.month-1,n.day)-Date.UTC(baseCreate.year,baseCreate.month-1,baseCreate.day))/86400000);
  let week=Math.max(0,Math.floor(dayDifference/7));
  let createAt=atWeek(createLocal,week,zone); let closeAt=atWeek(closeLocal,week,zone);
  if(now>=closeAt) { week++; createAt=atWeek(createLocal,week,zone); closeAt=atWeek(closeLocal,week,zone); }
  const close=localParts(closeAt,zone); const create=localParts(createAt,zone);
  const eventDate=`${close.year}-${String(close.month).padStart(2,'0')}-${String(close.day).padStart(2,'0')}`;
  return {
    eventDate,
    eventMonthDay:`${String(close.month).padStart(2,'0')}.${String(close.day).padStart(2,'0')}`,
    eventKey:`${eventDate}@${String(create.hour).padStart(2,'0')}:${String(create.minute).padStart(2,'0')}`,
    createAt,closeAt
  };
}
export function isoNow(date = new Date()): string { return date.toISOString(); }

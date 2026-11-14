// Minimal iCalendar (.ics) reader: VEVENT with DTSTART/DTEND/SUMMARY/LOCATION/URL
// and the common RRULE shapes (DAILY / WEEKLY with BYDAY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL).

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseDate(value, params) {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{8}$/.test(v) || (params && /VALUE=DATE(?!-)/i.test(params))) {
    return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  // TZID-qualified or floating times are treated as local time.
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
}

function unescape(s) {
  return (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

const MEETING_RE = /(https?:\/\/[^\s"<>]*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)[^\s"<>]*)/i;

function parseICS(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        const end = cur.end || new Date(cur.start.getTime() + (cur.allDay ? 864e5 : 36e5));
        const text = `${cur.location || ''} ${cur.url || ''} ${cur.description || ''}`;
        const meet = text.match(MEETING_RE);
        events.push({
          title: cur.summary || 'Event',
          start: cur.start,
          end,
          allDay: cur.allDay,
          location: cur.location || '',
          url: meet ? meet[1] : (cur.url || ''),
          rrule: cur.rrule || null,
          exdates: cur.exdates,
          status: cur.status || '',
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...rest] = left.split(';');
    const params = rest.join(';');
    switch (name.toUpperCase()) {
      case 'SUMMARY': cur.summary = unescape(value); break;
      case 'LOCATION': cur.location = unescape(value); break;
      case 'DESCRIPTION': cur.description = unescape(value); break;
      case 'URL': cur.url = value; break;
      case 'STATUS': cur.status = value; break;
      case 'RRULE': cur.rrule = value; break;
      case 'DTSTART': { const d = parseDate(value, params); if (d) { cur.start = d.date; cur.allDay = d.allDay; } break; }
      case 'DTEND': { const d = parseDate(value, params); if (d) cur.end = d.date; break; }
      case 'EXDATE': for (const part of value.split(',')) { const d = parseDate(part, params); if (d) cur.exdates.push(d.date.getTime()); } break;
      default: break;
    }
  }
  return events.filter((e) => e.status.toUpperCase() !== 'CANCELLED');
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandEvents(events, from, to) {
  const out = [];
  for (const ev of events) {
    const dur = ev.end - ev.start;
    if (!ev.rrule) {
      if (ev.end >= from && ev.start <= to) out.push(ev);
      continue;
    }
    const r = Object.fromEntries(ev.rrule.split(';').map((p) => p.split('=')));
    const freq = r.FREQ;
    const interval = +(r.INTERVAL || 1);
    const count = r.COUNT ? +r.COUNT : Infinity;
    const until = r.UNTIL ? (parseDate(r.UNTIL) || {}).date : null;
    const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : null;
    let n = 0;
    const push = (start) => {
      if (until && start > until) return false;
      if (n >= count) return false;
      n++;
      if (ev.exdates.includes(start.getTime())) return true;
      const end = new Date(start.getTime() + dur);
      if (end >= from && start <= to) out.push({ ...ev, start, end });
      return true;
    };
    const base = new Date(ev.start);
    const hardStop = new Date(to.getTime() + 864e5);
    let guard = 0;
    if (freq === 'WEEKLY' && byday) {
      const weekStart = new Date(base); weekStart.setDate(base.getDate() - base.getDay());
      for (let w = new Date(weekStart); w <= hardStop && guard < 5000; w.setDate(w.getDate() + 7 * interval), guard++) {
        let stop = false;
        for (const d of [...byday].sort()) {
          const s = new Date(w); s.setDate(w.getDate() + d);
          s.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), 0);
          if (s < base) continue;
          if (!push(s)) { stop = true; break; }
        }
        if (stop) break;
      }
      continue;
    }
    for (let s = new Date(base); s <= hardStop && guard < 5000; guard++) {
      if (!push(new Date(s))) break;
      if (freq === 'DAILY') s.setDate(s.getDate() + interval);
      else if (freq === 'WEEKLY') s.setDate(s.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') s.setMonth(s.getMonth() + interval);
      else if (freq === 'YEARLY') s.setFullYear(s.getFullYear() + interval);
      else break;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

module.exports = { parseICS, expandEvents };

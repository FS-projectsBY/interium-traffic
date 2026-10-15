// Хранилище данных. Два режима с одинаковым набором функций:
//  • firebase — общая база Firestore и вход по e-mail/паролю (рабочий режим на сайте);
//  • local    — демонстрационный режим в одном браузере (для проверки без интернета).
const T = globalThis.Traffic;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const lower = s => String(s || '').trim().toLowerCase();
const clean = o => JSON.parse(JSON.stringify(o ?? null));

export const ROLES = { admin: 'Администратор', editor: 'Охрана — ввод данных', viewer: 'Просмотр' };

export async function createStore(config) {
  const wantLocal = new URLSearchParams(location.search).has('local') || !config?.firebase?.apiKey;
  return wantLocal ? createLocalStore(config) : createFirebaseStore(config);
}

// ---------------- Firebase ----------------
async function createFirebaseStore(config) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')
  ]);
  const { initializeApp, deleteApp } = appMod;
  const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence } = authMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, getDoc, getDocs, writeBatch, serverTimestamp, query, orderBy, limit, deleteDoc, setDoc } = fsMod;

  const app = initializeApp(config.firebase);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  // Локальный кэш: страница открывается быстро и не теряет введённое при кратком пропадании интернета.
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const admins = (config.admins || []).map(lower);
  let me = null, authCb = null;
  // Логин без «@» превращается в служебный адрес: «ohrana» → ohrana@<домен>. Почта сотруднику не нужна.
  const domain = config.loginDomain || 'interium.local';
  const toEmail = login => { const l = lower(login); return l.includes('@') ? l : l + '@' + domain; };
  const loginOf = email => email.endsWith('@' + domain) ? email.slice(0, -domain.length - 1) : email;

  const tsToIso = v => v?.toDate ? v.toDate().toISOString() : (typeof v === 'string' ? v : undefined);
  // Повреждённый документ пропускается, чтобы одна ошибочная запись не останавливала программу у всех.
  const safe = (f, d) => { try { return f(d); } catch (err) { console.warn('Пропущен документ', d.id, err.message); return null; } };
  const fromDay = d => { const x = d.data(); return T.validateRecord({ ...x, date: d.id, updatedAt: tsToIso(x.updatedAt) }); };
  const fromEvent = d => T.validateEvent({ ...d.data(), id: d.id });
  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: me.email });
  const log = (action, target, before, after) => ({ at: serverTimestamp(), by: me.email, action, target: String(target).slice(0, 120), before: clean(before), after: clean(after) });
  const dayData = r => { const { updatedAt, updatedBy, ...rest } = T.validateRecord(r); return clean(rest); };
  const eventData = e => { const { id, ...rest } = T.validateEvent(e); return clean(rest); };
  // Каждая запись дня или события ссылается на запись журнала (logId); правила проверяют, что журнал создан в той же операции.
  function withLog(action, target, before, after, write) {
    const b = writeBatch(db), ref = doc(collection(db, 'log'));
    b.set(ref, log(action, target, before, after)); write(b, ref.id); return commit(b);
  }
  // Без интернета запись сохраняется на устройстве и отправляется позже; не ждём ответа сервера бесконечно.
  let writeErrorHandler = null;
  function commit(b) {
    const p = b.commit();
    p.catch(err => writeErrorHandler?.(err));
    return Promise.race([p.then(() => 'saved'), new Promise(ok => setTimeout(() => ok('queued'), navigator.onLine ? 8000 : 600))]);
  }

  async function handleUser(user) {
    if (!user) { me = null; authCb?.(null); return; }
    const email = lower(user.email), isAdminEmail = admins.includes(email);
    if (isAdminEmail && !user.emailVerified) { me = { email, name: email, role: null, needsVerify: true }; authCb?.(me); return; }
    let role = isAdminEmail ? 'admin' : null, name = '';
    try {
      const snap = await getDoc(doc(db, 'users', email));
      if (snap.exists()) { const u = snap.data(); if (!role && u.active !== false) role = u.role; name = u.name || ''; }
    } catch (err) { console.warn('Роль не прочитана', err); }
    me = { email, name: name || loginOf(email), role };
    authCb?.(me);
  }

  return {
    kind: 'firebase',
    onWriteError(cb) { writeErrorHandler = cb; },
    loginOf,
    onAuth(cb) {
      authCb = cb;
      return onAuthStateChanged(auth, handleUser);
    },
    // Пароль задаёт сам человек. Администратор подтверждает почту по ссылке из письма — до этого прав администратора нет.
    signIn: (login, password) => signInWithEmailAndPassword(auth, toEmail(login), password),
    signOut: () => signOut(auth),
    resetPassword: email => sendPasswordResetEmail(auth, lower(email)),
    async setupAdmin(password) { const c = await createUserWithEmailAndPassword(auth, admins[0], password); await sendEmailVerification(c.user); },
    sendVerification: () => sendEmailVerification(auth.currentUser),
    async recheck() { if (auth.currentUser) { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); await handleUser(auth.currentUser); } },
    // Логин сотрудника создаётся отдельным экземпляром приложения, чтобы администратор не вышел из своей учётной записи.
    async createAccount(login, password) {
      const second = initializeApp(config.firebase, 'add-user-' + Date.now());
      try { const a = getAuth(second); await createUserWithEmailAndPassword(a, toEmail(login), password); await signOut(a); }
      catch (err) { if (String(err.code).includes('email-already-in-use')) throw Error('Логин «' + login + '» уже занят. Выберите другой.'); throw err; }
      finally { await deleteApp(second); }
      return toEmail(login);
    },
    toEmail,

    subscribe(cb, onError) {
      const state = { records: null, events: null, notes: {}, pd: false, pe: false };
      const emit = () => { if (state.records && state.events) cb({ records: [...state.records].sort((a, b) => a.date.localeCompare(b.date)), events: state.events, notes: state.notes, pending: state.pd || state.pe }); };
      const u1 = onSnapshot(collection(db, 'days'), { includeMetadataChanges: true }, s => { state.records = s.docs.map(d => safe(fromDay, d)).filter(Boolean); state.pd = s.metadata.hasPendingWrites; emit(); }, onError);
      const u2 = onSnapshot(collection(db, 'events'), { includeMetadataChanges: true }, s => { state.events = s.docs.map(d => safe(fromEvent, d)).filter(Boolean); state.pe = s.metadata.hasPendingWrites; emit(); }, onError);
      // Комментарии к месяцам и неделям — небольшая коллекция, читается целиком.
      const u3 = onSnapshot(collection(db, 'notes'), s => { const n = {}; s.docs.forEach(d => { const x = d.data(); if (typeof x.text === 'string') n[d.id] = { text: x.text, updatedBy: x.updatedBy || '', updatedAt: tsToIso(x.updatedAt) }; }); state.notes = n; emit(); }, err => console.warn('Комментарии недоступны', err));
      return () => { u1(); u2(); u3(); };
    },
    saveNote(key, text) {
      const ref = doc(db, 'notes', key);
      if (!text.trim()) { const b = writeBatch(db); b.delete(ref); return commit(b); }
      const b = writeBatch(db); b.set(ref, { text: text.slice(0, 3000), updatedAt: serverTimestamp(), updatedBy: me.email }); return commit(b);
    },
    saveDay(record, before) {
      const data = dayData(record);
      return withLog(before ? 'day.update' : 'day.create', data.date, before ? dayData(before) : null, data, (b, logId) => b.set(doc(db, 'days', data.date), { ...data, ...stamp(), logId }));
    },
    deleteDay(date, before) { return withLog('day.delete', date, before ? dayData(before) : null, null, b => b.delete(doc(db, 'days', date))); },
    saveEvent(event, before) {
      const e = T.validateEvent(event);
      return withLog(before ? 'event.update' : 'event.create', e.id, before ? eventData(before) : null, eventData(e), (b, logId) => b.set(doc(db, 'events', e.id), { ...eventData(e), ...stamp(), logId }));
    },
    deleteEvent(id, before) { return withLog('event.delete', id, before ? eventData(before) : null, null, b => b.delete(doc(db, 'events', id))); },
    // Массовая загрузка (только администратор): Excel-история или резервная копия, пачками по 400.
    async bulkImport({ records = [], events = [], info }) {
      const logRef = doc(collection(db, 'log')), logId = logRef.id, ops = [];
      ops.push(b => b.set(logRef, log('import', info?.name || 'import', null, { days: records.length, events: events.length, first: info?.first || '', last: info?.last || '' })));
      records.forEach(r => { const d = dayData(r); ops.push(b => b.set(doc(db, 'days', d.date), { ...d, ...stamp(), logId })); });
      events.forEach(e => { const v = T.validateEvent(e); ops.push(b => b.set(doc(db, 'events', v.id), { ...eventData(v), ...stamp(), logId })); });
      for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(f => f(b)); await b.commit(); }
    },
    async listUsers() { const s = await getDocs(collection(db, 'users')); return s.docs.map(d => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email)); },
    async saveUser(u) { const email = lower(u.email); await setDoc(doc(db, 'users', email), { name: String(u.name || '').slice(0, 120), role: u.role, active: u.active !== false, updatedAt: serverTimestamp(), updatedBy: me.email }); },
    async removeUser(email) { await deleteDoc(doc(db, 'users', lower(email))); },
    async readLog(n = 60) {
      const s = await getDocs(query(collection(db, 'log'), orderBy('at', 'desc'), limit(n)));
      return s.docs.map(d => { const x = d.data(); return { ...x, at: tsToIso(x.at) }; });
    }
  };
}

// ---------------- Демонстрационный режим ----------------
async function createLocalStore(config) {
  const KEY = 'interium-traffic-demo-v2';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  let data = read();
  if (!data) {
    data = { records: [], events: [], users: [], log: [], notes: {} };
    // Для проверки на компьютере разработчика подхватывается локальная копия истории (на сайт она не публикуется).
    if (['localhost', '127.0.0.1'].includes(location.hostname)) try { const r = await fetch('data/seed.json', { cache: 'no-store' }); if (r.ok) { const s = T.validateState(await r.json()); data.records = s.records; data.events = s.events.map(e => e.id === 'dns' ? { ...e, levelShift: true } : e); } } catch {}
  }
  const listeners = new Set(); let me = null, authCb = null;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} listeners.forEach(f => f(snapshot())); };
  data.notes ||= {};
  const snapshot = () => ({ records: [...data.records].sort((a, b) => a.date.localeCompare(b.date)), events: [...data.events], notes: { ...data.notes }, pending: false });
  const addLog = (action, target, before, after) => { data.log.unshift({ at: new Date().toISOString(), by: me?.email || 'demo', action, target, before: clean(before), after: clean(after) }); data.log = data.log.slice(0, 500); };
  const stamp = r => ({ ...r, updatedAt: new Date().toISOString(), updatedBy: me?.email || 'demo' });
  const sessionRole = () => { try { return sessionStorage.getItem(KEY + '-role'); } catch { return null; } };
  return {
    kind: 'local',
    loginOf: e => e, toEmail: l => lower(l).includes('@') ? lower(l) : lower(l) + '@interium.local',
    async createAccount(login) { return this.toEmail(login); },
    onWriteError() {},
    onAuth(cb) { authCb = cb; const role = new URLSearchParams(location.search).get('role') || sessionRole(); me = role && ROLES[role] ? { email: 'demo-' + role + '@local', name: 'Демо: ' + ROLES[role], role } : null; setTimeout(() => cb(me)); return () => {}; },
    async signIn(role) { try { sessionStorage.setItem(KEY + '-role', role); } catch {} me = { email: 'demo-' + role + '@local', name: 'Демо: ' + ROLES[role], role }; authCb?.(me); },
    async signOut() { try { sessionStorage.removeItem(KEY + '-role'); } catch {} me = null; authCb?.(null); },
    subscribe(cb) { listeners.add(cb); setTimeout(() => cb(snapshot())); return () => listeners.delete(cb); },
    async saveDay(record, before) { const r = stamp(T.validateRecord(record)); data.records = data.records.filter(x => x.date !== r.date).concat(r); addLog(before ? 'day.update' : 'day.create', r.date, before, r); persist(); },
    async saveNote(key, text) { if (text.trim()) data.notes[key] = { text: text.slice(0, 3000), updatedBy: me?.email || 'demo', updatedAt: new Date().toISOString() }; else delete data.notes[key]; persist(); },
    async deleteDay(date, before) { data.records = data.records.filter(x => x.date !== date); addLog('day.delete', date, before, null); persist(); },
    async saveEvent(event, before) { const e = T.validateEvent(event); data.events = data.events.filter(x => x.id !== e.id).concat(e); addLog(before ? 'event.update' : 'event.create', e.id, before, e); persist(); },
    async deleteEvent(id, before) { data.events = data.events.filter(x => x.id !== id); addLog('event.delete', id, before, null); persist(); },
    async bulkImport({ records = [], events = [], info }) {
      const m = new Map(data.records.map(r => [r.date, r])); records.forEach(r => m.set(r.date, stamp(T.validateRecord(r)))); data.records = [...m.values()];
      const em = new Map(data.events.map(e => [e.id, e])); events.forEach(e => { const v = T.validateEvent(e); em.set(v.id, v); }); data.events = [...em.values()];
      addLog('import', info?.name || 'import', null, { days: records.length, events: events.length }); persist();
    },
    async listUsers() { return [...data.users]; },
    async saveUser(u) { data.users = data.users.filter(x => x.email !== lower(u.email)).concat({ email: lower(u.email), name: u.name || '', role: u.role, active: u.active !== false }); persist(); },
    async removeUser(email) { data.users = data.users.filter(x => x.email !== lower(email)); persist(); },
    async readLog(n = 60) { return data.log.slice(0, n); }
  };
}

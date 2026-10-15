// Настройки подключения. Значения firebase — из консоли Firebase (Настройки проекта → Ваши приложения → Web).
// Эти ключи не секретные: доступ к данным ограничивают правила Firestore (firestore.rules).
// Пока apiKey пустой, программа работает в демонстрационном режиме в одном браузере.
export const CONFIG = {
  firebase: {
    apiKey: 'AIzaSyA67jZrIocVTFC6FUXc8TazRCjDB82YIgs',
    authDomain: 'interium-traffic.firebaseapp.com',
    projectId: 'interium-traffic',
    appId: '1:848411367410:web:3fc10b1836745cdc32bd6b'
  },
  // Администраторы: могут выдавать доступ и загружать историю. Тот же список — в firestore.rules.
  admins: ['snabjenecc@gmail.com'],
  // Логин сотрудника без «@» превращается в адрес логин@loginDomain (почтовый ящик не нужен).
  loginDomain: 'interium.local'
};

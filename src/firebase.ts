// Инициализация Firebase. Конфиг публичный: это адрес проекта, а не секрет —
// доступ к данным защищают правила Firestore.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBJLAQDeF5ZodLkLqx2ioFRSRjS07zCBso',
  authDomain: 'verstak-9e1df.firebaseapp.com',
  projectId: 'verstak-9e1df',
  storageBucket: 'verstak-9e1df.firebasestorage.app',
  messagingSenderId: '306160003022',
  appId: '1:306160003022:web:1d954ed81bbb48e3752d9f',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Локальный кэш в IndexedDB: повторный вход и перезагрузка не тратят чтений.
// Менеджер вкладок позволяет держать приложение открытым в нескольких вкладках.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

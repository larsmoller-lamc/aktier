// Firebase-konfiguration – indsæt værdierne fra Firebase-konsollen (Project settings → Your apps → Config)
const firebaseConfig = {
  apiKey: "INDSÆT",
  authDomain: "INDSÆT.firebaseapp.com",
  projectId: "INDSÆT",
  storageBucket: "INDSÆT.appspot.com",
  messagingSenderId: "INDSÆT",
  appId: "INDSÆT"
};
const ALLOWED_EMAIL = "larsmollerchristensen@gmail.com";
const ROOT = "aktier";              // Firestore: aktier/portfolio (kurser) + aktier/portfolio/trades/{id}

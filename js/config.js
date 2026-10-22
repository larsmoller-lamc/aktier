// Firebase-konfiguration – indsæt værdierne fra Firebase-konsollen (Project settings → Your apps → Config)
const firebaseConfig = {
  apiKey: "AIzaSyB8XaOlfhrrcqASUk9elz3teaizFCNXjuA",
  authDomain: "aktier-b1724.firebaseapp.com",
  projectId: "aktier-b1724",
  storageBucket: "aktier-b1724.firebasestorage.app",
  messagingSenderId: "1051907755826",
  appId: "1:1051907755826:web:8b6b8e8ed3aaa3e466112b"
};
const ALLOWED_EMAIL = "larsmollerchristensen@gmail.com";
const ROOT = "aktier";              // Firestore: aktier/portfolio (kurser) + aktier/portfolio/trades/{id}

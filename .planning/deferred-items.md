
## CORS: Access-Control-Allow-Headers wildcard vs Authorization (2026-07-20, live FF warning)
Firefox loguje przy każdym syncu z rozszerzenia: "When the `Access-Control-Allow-Headers` is `*`, the `Authorization` header is not covered" — przyszła zmiana przeglądarek wyłączy Authorization z wildcardu. Fix: crates/pv-server CORS layer ma jawnie listować `Authorization` (+ pozostałe używane nagłówki) zamiast `*`. Nie blokuje dziś; zrobić przy najbliższym dotknięciu warstwy CORS (np. przy D-10 moz-wildcard→konkretne originy).

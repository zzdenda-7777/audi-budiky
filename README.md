# Audi Budíky

Android aplikace, která přes diagnostický kabel KKL (FTDI / CH340) a OTG redukci čte
měřené hodnoty z řídicí jednotky motoru (protokol KW1281) a ukazuje je jako budíky.
Psáno pro Audi A4 B6 2.5 V6 TDI (BDG), ale funguje s jednotkami VAG, které mluví KW1281.

## Instalace
1. Stáhni `AudiBudiky.apk` z větve **apk** (nebo z GitHub Actions → poslední běh → Artifacts).
2. V telefonu povol instalaci z neznámých zdrojů a APK nainstaluj.

## Použití
1. Kabel do OBD zásuvky, druhý konec přes OTG redukci do telefonu.
2. Zapni zapalování (nebo nastartuj).
3. Otevři aplikaci, klepni na **Připojit** a povol přístup ke kabelu.

Čtené skupiny: 011 (turbo), 001 (vstřik, teplota), 003 (MAF, EGR). Vlastní skupiny
se dají nastavit v "Data a log". Přepočet hodnot vychází z veřejných tabulek KW1281;
porovnej je s VCDS-Lite.

Nepoužívej současně s VCDS-Lite (na K-lince smí mluvit jen jedno zařízení).
Za jízdy se na displej nedívej déle než na běžný budík.

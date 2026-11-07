# Monochrome Alpine: визуальная проверка

Новый интерфейс использует чёрный фон, белую типографику, крупные числовые показатели и сдержанные серые поверхности. Прежние зелёные акценты, одинаковая подача всех показателей и монолитная разметка главной заменены иерархией: сезонная дистанция, действие, рекорды, последняя запись. Общие компоненты вынесены в components, главная — в screens/Home, расчёты — в metrics. Значения по-прежнему берутся из сохранённых треков; демо явно отделено.

## Заставка

Фон строго `#000000`. Белый сноубордист имеет ширину 136 CSS px и расположен точно по центру viewport по обеим осям. Подпись не сдвигает центр иконки. Появление: opacity и scale 0.96 → 1; уход: короткое затухание. Нет вращения, вспышек, текстуры, полноэкранного рисунка и обязательной задержки ради анимации. При долгом запросе появляется состояние загрузки, при ошибке — объяснение и повтор. Reduced motion отключает движение.

После получения референса прежний геометрический знак заменён очищенной иконкой с позой сноубордиста из прикреплённого изображения. rider.png используется в заставке, шапке и favicon; серый квадрат и текстурная подложка не используются. Силуэт вписан в квадрат без растяжения. Чёрная подложка ассета сливается с заставкой; в остальных местах CSS screen смешивает чёрный с фоном.

## Система интерфейса

Цвета, интервалы и радиусы собраны в frontend/src/tokens.css; общие состояния и компоненты — в style.css и components/UI.tsx. Навигация снизу учитывает safe areas Telegram и устройства. Поля не меньше 16 px, интерактивные области от 44 px. Большие показатели имеют табличные цифры. Кнопки записи закреплены над навигацией. Входная анимация меняет только opacity, чтобы не создавать содержащий блок для fixed-панелей.

Leaflet загружается отдельно при открытии карты, без нового UI-фреймворка, шрифтов или платных ресурсов. Основной JS около 271 kB до gzip, Leaflet около 150 kB отдельным chunk. Карта сохраняет атрибуцию; цвета маршрута функциональны. Нет выдуманной географии или декоративного трека вместо GPS.

## Галерея

Снимки Chromium с эмуляцией мобильного viewport, не физического iPhone. Тестовая БД изолирована в памяти. Профиль тестовый, демонстрационный маршрут подписан. Внешние тайлы намеренно отключены: на снимках проверяется честное сообщение о недоступной подложке, а не доступность OSM. Активная запись использует координаты эмулятора. Увеличенный текст — реальные вычисленные размеры ×1.25.

| Экран             | 375 × 812                                             | 390 × 844                                             | 430 × 932                                             |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Заставка          | [PNG](screenshots/premium/375/splash.png)             | [PNG](screenshots/premium/390/splash.png)             | [PNG](screenshots/premium/430/splash.png)             |
| Главная           | [PNG](screenshots/premium/375/home.png)               | [PNG](screenshots/premium/390/home.png)               | [PNG](screenshots/premium/430/home.png)               |
| Нет записей       | [PNG](screenshots/premium/375/empty.png)              | [PNG](screenshots/premium/390/empty.png)              | [PNG](screenshots/premium/430/empty.png)              |
| Катание до старта | [PNG](screenshots/premium/375/ride-idle.png)          | [PNG](screenshots/premium/390/ride-idle.png)          | [PNG](screenshots/premium/430/ride-idle.png)          |
| Запись активна    | [PNG](screenshots/premium/375/ride-active.png)        | [PNG](screenshots/premium/390/ride-active.png)        | [PNG](screenshots/premium/430/ride-active.png)        |
| Пауза             | [PNG](screenshots/premium/375/ride-paused.png)        | [PNG](screenshots/premium/390/ride-paused.png)        | [PNG](screenshots/premium/430/ride-paused.png)        |
| Карта             | [PNG](screenshots/premium/375/map.png)                | [PNG](screenshots/premium/390/map.png)                | [PNG](screenshots/premium/430/map.png)                |
| Маршрут демо      | [PNG](screenshots/premium/375/route-details.png)      | [PNG](screenshots/premium/390/route-details.png)      | [PNG](screenshots/premium/430/route-details.png)      |
| Прогресс          | [PNG](screenshots/premium/375/progress.png)           | [PNG](screenshots/premium/390/progress.png)           | [PNG](screenshots/premium/430/progress.png)           |
| История           | [PNG](screenshots/premium/375/history.png)            | [PNG](screenshots/premium/390/history.png)            | [PNG](screenshots/premium/430/history.png)            |
| Профиль           | [PNG](screenshots/premium/375/profile.png)            | [PNG](screenshots/premium/390/profile.png)            | [PNG](screenshots/premium/430/profile.png)            |
| Увеличенный текст | [PNG](screenshots/premium/375/profile-large-type.png) | [PNG](screenshots/premium/390/profile-large-type.png) | [PNG](screenshots/premium/430/profile-large-type.png) |

## Проверки и ограничения

`npm run check`, `npm run build`, `npm test`: успешно; 50 unit/integration tests. Playwright: 8 тестов, в том числе существующие GPS/GPX/профиль/история, три размера, ошибка авторизации/reduced motion и 393 px с Telegram safe areas. Проверяется отсутствие горизонтального overflow, центр/размер/фон заставки и положение fixed-панелей.

На реальном Windows/iPhone остаются: двойной щелчок BAT после чистого ZIP, действующий Funnel и мобильный интернет, Telegram initData, системное увеличение текста, клавиатура, загрузка тайлов, разрешение GPS и открытие после перезапуска. Непрерывный фоновый GPS не обещается. Браузерные mocks не доказывают доступность Telegram API или Tailscale.

Сценарий без Git и с сохранением .env/SQLite: [START_WINDOWS_RU.md](START_WINDOWS_RU.md).

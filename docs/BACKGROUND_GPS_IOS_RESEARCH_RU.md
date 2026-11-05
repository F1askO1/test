# Фоновая геолокация iOS: техническое заключение

Дата: 5 ноября 2026. **Telegram Mini App не является нативным Core Location recorder. Непрерывная запись с заблокированным iPhone внутри WebView не гарантируется.** Хранить уже полученные точки и получать новые точки при заблокированном экране — разные функции.

## Источники и доступность исследования

- Telegram Mini Apps / LocationManager: https://core.telegram.org/bots/webapps#locationmanager . API init/getLocation предоставляет запрос положения, не нативный фоновый location service с управлением Background Modes. Прямое открытие страницы в текущей cloud-сети получило 403; свежесть полного текста не подтверждена.
- MDN watchPosition: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition . Официальный исходный текст изучен через https://github.com/mdn/content/blob/main/files/en-us/web/api/geolocation/watchposition/index.md : HTTPS, явное разрешение, callbacks и clearWatch; **нет гарантии фонового исполнения**.
- Geolocation specification: https://w3c.github.io/geolocation/ — учитывает жизненный цикл document; Service Worker не превращает страницу в Core Location process.
- WebKit lifecycle: https://webkit.org/blog/ — iOS может приостановить/выгрузить WebView. Не используем аудио, скрытые страницы, вечные таймеры или Wake Lock как обещание фонового GPS.
- Apple Core Location: https://developer.apple.com/documentation/corelocation
- Background: https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background
- CLLocationManager: https://developer.apple.com/documentation/corelocation/cllocationmanager
- CLBackgroundActivitySession: https://developer.apple.com/documentation/corelocation/clbackgroundactivitysession
- CLServiceSession: https://developer.apple.com/documentation/corelocation/clservicesession

Apple-страницы тоже закрыты network policy (403); ссылки — проверяемые официальные точки входа, а не заявление об успешном прочтении актуальной версии каждой. Используем документированную традиционную модель CLLocationManager для iOS 17+, явно отмечая необходимость приёмки через Xcode и реальное устройство.

## Сравнение

| Механизм                                              | Открытое приложение      | Заблокированный экран                            | После force quit                                |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| Web watchPosition / Telegram getLocation              | При разрешении/поддержке | Нет гарантии новых точек                         | Нет записи                                      |
| IndexedDB                                             | Сохраняет полученное     | Не получает GPS сама                             | Может восстановить сохранённое на том же origin |
| Нативный CLLocationManager + location Background Mode | Явно запущенная запись   | Поддерживаемый iOS механизм, требуется испытание | Непрерывность не обещается                      |

Нативный проект запрашивает When In Use и full accuracy. Явное начало на переднем плане, allowsBackgroundLocationUpdates, showsBackgroundLocationIndicator и UIBackgroundModes=location. Не запрашиваем Always автоматически: для уже начатой foreground-записи с видимой фоновой активностью оно не должно быть первым выбором. Перед распространением проверьте поведение конкретной версии iOS и её authorization model. Нет обещания relaunch после force quit, записи до first unlock или после выключения.

CLBackgroundActivitySession (iOS 17+) и CLServiceSession (iOS 18+) — возможная дальнейшая современная модель управления жизненным циклом и диагностикой разрешений. Они не доступны JS Telegram. Подготовленный companion использует CLLocationManager, а не неподтверждённую смесь трёх location-моделей. Переход на новые sessions требует SDK/availability и испытаний; сами по себе они не обходят force quit и необходимость согласия.

## Вывод

Для требования «положить заблокированный iPhone в карман на часы» нужен отдельно установленный native companion. В репозитории подготовлен исходный проект, безопасная привязка, локальная запись и синхронизация. В Linux/Windows без Xcode/signing нельзя честно объявить его собранным, энергоэффективным или прошедшим 60 минут на реальном iPhone. До этого функция экспериментальна, не критерий готовой фоновой эксплуатации.

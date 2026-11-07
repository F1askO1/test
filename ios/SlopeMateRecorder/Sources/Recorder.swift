import Foundation
import CoreLocation
import Combine
import Security
import Network

struct GPSPoint: Codable {
    var lat: Double; var lon: Double; var t: Double
    var alt: Double?; var accuracy: Double?; var altAccuracy: Double?; var speed: Double?
    var breakBefore: Bool
}
struct Recording: Codable {
    var id: String; var started: Double; var finished: Bool = false; var synced: Bool = false
    var resort: String = ""; var trip: String = ""
}
struct Credentials: Codable { var server: String; var id: String; var key: String }

enum SecureStore {
    static let account = "slopemate-recorder-device"
    static func load() -> Credentials? {
        let q: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrAccount as String:account, kSecReturnData as String:true, kSecMatchLimit as String:kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data=item as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from:data)
    }
    static func save(_ credentials: Credentials) throws {
        let data=try JSONEncoder().encode(credentials)
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrAccount as String:account]
        let updated=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if updated == errSecItemNotFound {
            var item=query; item[kSecValueData as String]=data
            item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary,nil) == errSecSuccess else { throw RecorderError.storage }
        } else if updated != errSecSuccess { throw RecorderError.storage }
    }
    static func clear() { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrAccount as String:account] as CFDictionary) }
}
enum RecorderError: Error { case storage, server, invalidLink, redirect }
// Refuse redirects: never forward a device credential to another host.
final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session:URLSession, task:URLSessionTask, willPerformHTTPRedirection response:HTTPURLResponse, newRequest request:URLRequest, completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
}
@MainActor final class Recorder: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var active=false
    @Published var count=0
    @Published var message="Готов к записи. Фоновая работа требует разрешения GPS."
    @Published var paired=SecureStore.load() != nil
    @Published var pairingHost: String?
    @Published var history: [Recording]=[]
    private let manager=CLLocationManager()
    private let network=NWPathMonitor()
    private var syncing=false
    private let disk=DispatchQueue(label:"slopemate.recorder.disk")
    private let root:URL
    private var current:Recording?
    private var lastTimestamp:Double=0
    private var gap=true
    private var pendingPair:URLComponents?
    override init(){
        root=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("SlopeMateTracks",isDirectory:true)
        super.init()
        do { try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication]) } catch { message="Не удалось открыть хранилище. Запись не начата." }
        manager.delegate=self;manager.desiredAccuracy=kCLLocationAccuracyBest
        manager.distanceFilter=5;manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically=false
        network.pathUpdateHandler={ [weak self] path in
            if path.status == .satisfied { Task { @MainActor in if self?.paired == true { await self?.sync() } } }
        }
        network.start(queue:DispatchQueue(label:"slopemate.network"))
        refreshHistory()
        // Recover an unfinished track; acquiring new coordinates still requires explicit Start.
        if let unfinished=history.first(where:{!$0.finished}) {
            current=unfinished;count=(try? readPoints(unfinished.id).count) ?? 0
            lastTimestamp=(try? readPoints(unfinished.id).last?.t) ?? 0
            message="Незавершённая запись восстановлена. Нажмите продолжить; отсутствующие точки не восстановлены."
        }
    }
    private func directory(_ id:String)->URL {root.appendingPathComponent(id,isDirectory:true)}
    private func saveMeta(_ item:Recording) throws {
        let dir=directory(item.id);try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        try JSONEncoder().encode(item).write(to:dir.appendingPathComponent("meta.json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
    }
    private func readPoints(_ id:String) throws -> [GPSPoint] {
        let url=directory(id).appendingPathComponent("points.ndjson")
        guard FileManager.default.fileExists(atPath:url.path) else{return []}
        let data=try Data(contentsOf:url)
        // A crash can leave only the final line incomplete. Preserve all complete preceding records.
        return data.split(separator:10).compactMap{try? JSONDecoder().decode(GPSPoint.self,from:Data($0))}
    }
    func refreshHistory(){
        history=((try? FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:nil)) ?? []).compactMap{try? JSONDecoder().decode(Recording.self,from:Data(contentsOf:$0.appendingPathComponent("meta.json")))}.sorted{$0.started>$1.started}
    }
    func start(){
        if manager.authorizationStatus == .notDetermined {manager.requestWhenInUseAuthorization();message="Разрешите геолокацию, затем нажмите начать ещё раз.";return}
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {message="Доступ к GPS запрещён. Измените разрешение в настройках iOS.";return}
        if manager.accuracyAuthorization != .fullAccuracy {message="Включите точную геопозицию в настройках iOS. Запись не начата.";return}
        do {if current == nil {current=Recording(id:UUID().uuidString.lowercased(),started:Date().timeIntervalSince1970*1000);count=0;lastTimestamp=0};try saveMeta(current!)}catch{message="Не удалось сохранить начало записи. GPS не запущен.";return}
        gap=true;manager.allowsBackgroundLocationUpdates=true;manager.showsBackgroundLocationIndicator=true
        active=true;manager.startUpdatingLocation();message="Запись идёт. iOS может показывать индикатор фоновой геолокации."
    }
    func pause(){active=false;gap=true;manager.stopUpdatingLocation();manager.allowsBackgroundLocationUpdates=false;message="Пауза. Полученные точки сохранены."}
    func finish(){
        pause();guard var item=current else{return};item.finished=true
        disk.sync {} // Flush all accepted points before marking the session complete.
        do{try saveMeta(item);current=nil;refreshHistory();message="Запись завершена и сохранена на iPhone.";Task{await sync()}}catch{message="Не удалось завершить запись на диске. Локальные точки не удалены."}
    }
    func locationManager(_ manager:CLLocationManager,didUpdateLocations locations:[CLLocation]){
        guard active,let item=current else{return}
        for location in locations.sorted(by:{$0.timestamp<$1.timestamp}) {
            let t=location.timestamp.timeIntervalSince1970*1000
            guard t>lastTimestamp,location.horizontalAccuracy>=0,location.horizontalAccuracy<=65 else{gap=true;continue}
            guard count<40000 else{pause();message="Лимит 40 000 точек. Завершите запись и начните новую.";return}
            let p=GPSPoint(lat:location.coordinate.latitude,lon:location.coordinate.longitude,t:t,alt:location.verticalAccuracy>=0 ? location.altitude:nil,accuracy:location.horizontalAccuracy,altAccuracy:location.verticalAccuracy>=0 ? location.verticalAccuracy:nil,speed:location.speed>=0 ? location.speed:nil,breakBefore:gap || lastTimestamp>0 && t-lastTimestamp>35000)
            lastTimestamp=t;gap=false;count+=1
            let destination=directory(item.id).appendingPathComponent("points.ndjson")
            disk.async { [weak self] in
                do {
                    let file=destination
                    if !FileManager.default.fileExists(atPath:file.path){FileManager.default.createFile(atPath:file.path,contents:nil,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])}
                    let handle=try FileHandle(forUpdating:file);defer{try? handle.close()}
                    let length=try handle.seekToEnd()
                    if length>0 {try handle.seek(toOffset:length-1);let tail=try handle.read(upToCount:1);try handle.seekToEnd();if tail?.first != 10 {try handle.write(contentsOf:Data([10]))}}
                    var data=try JSONEncoder().encode(p);data.append(10);try handle.write(contentsOf:data);try handle.synchronize()
                }catch{DispatchQueue.main.async{self?.pause();self?.message="Ошибка локального хранения. Запись остановлена; проверьте свободное место."}}
            }
        }
    }
    func locationManager(_ manager:CLLocationManager,didFailWithError error:Error){gap=true;if (error as? CLError)?.code == .denied {pause()};message="GPS временно недоступен. Разрыв будет отмечен, координаты не выдумываются."}
    func locationManagerDidChangeAuthorization(_ manager:CLLocationManager){if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {pause();message="Разрешение GPS отозвано."}}
    func offerPair(_ url:URL){
        guard let c=URLComponents(url:url,resolvingAgainstBaseURL:false),c.scheme=="slopemate-recorder",c.host=="pair",let server=c.queryItems?.first(where:{$0.name=="server"})?.value,let s=URL(string:server),s.scheme=="https",s.user==nil,s.password==nil,s.query==nil,s.fragment==nil,(s.path=="" || s.path=="/"),s.host != nil else{message="Неверная ссылка привязки.";return}
        pendingPair=c;pairingHost=s.host // Show destination and require consent before sending code.
    }
    func confirmPair() async {
        guard let c=pendingPair,let server=c.queryItems?.first(where:{$0.name=="server"})?.value,let code=c.queryItems?.first(where:{$0.name=="code"})?.value else{return}
        pendingPair=nil;pairingHost=nil
        if SecureStore.load() != nil {message="Сначала отключите прежнюю привязку. Незагруженные записи не передаются другой учётной записи.";return}
        do{let response=try await request(server:server,path:"/api/device/redeem",body:["code":code],key:nil);guard let id=response["id"] as? String,let key=response["key"] as? String else{throw RecorderError.server};try SecureStore.save(Credentials(server:server,id:id,key:key));paired=true;message="Устройство привязано. BOT_TOKEN не хранится в приложении."}catch{message="Привязка не удалась. Проверьте сеть и получите новый код в Telegram."}
    }
    private func request(server:String,path:String,body:Any,key:String?) async throws -> [String:Any] {
        guard let url=URL(string:server+path),url.scheme=="https" else{throw RecorderError.invalidLink}
        var request=URLRequest(url:url);request.httpMethod="POST";request.timeoutInterval=60;request.setValue("application/json",forHTTPHeaderField:"Content-Type");if let key=key{request.setValue("Bearer "+key,forHTTPHeaderField:"Authorization")};request.httpBody=try JSONSerialization.data(withJSONObject:body)
        let session=URLSession(configuration:.ephemeral,delegate:NoRedirect(),delegateQueue:nil);defer{session.invalidateAndCancel()}
        let(data,response)=try await session.data(for:request);guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode),let result=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw RecorderError.server};return result
    }
    func sync() async {
        guard !syncing else{return};syncing=true;defer{syncing=false}
        guard let auth=SecureStore.load() else{message="Для синхронизации привяжите устройство в Telegram.";return}
        disk.sync {};refreshHistory()
        for var item in history where item.finished && !item.synced {
            do {
                let points=try readPoints(item.id);guard points.count>=2 else{continue}
                let array=try JSONSerialization.jsonObject(with:JSONEncoder().encode(points))
                let response=try await request(server:auth.server,path:"/api/device/sessions",body:["id":item.id,"points":array,"resort":item.resort,"trip":item.trip],key:auth.key)
                guard response["id"] as? String == item.id else{throw RecorderError.server}
                item.synced=true;try saveMeta(item) // Keep local data even after server acknowledgement.
            }catch{message="Синхронизация прервана. Все локальные треки сохранены; повторите при наличии сети.";refreshHistory();return}
        }
        refreshHistory();message="Синхронизация завершена. Переоткройте историю SlopeMate в Telegram."
    }
    func forget(){
        // Prevent upload of previous owner's unacknowledged recordings after re-pairing.
        guard history.allSatisfy({$0.synced}),current==nil else{message="Сначала завершите и синхронизируйте все записи. Перепривязка до этого запрещена.";return}
        SecureStore.clear();paired=false;message="Локальная привязка отключена. Доступ также можно отозвать в SlopeMate."
    }
}

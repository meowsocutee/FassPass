import { Component, OnInit, PLATFORM_ID, Inject, OnDestroy, AfterViewInit, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { BottomSheetService, SheetMode } from '../../services/bottom-sheet.service';
import { addIcons } from 'ionicons';
import { businessOutline, locateOutline, navigateOutline, pinOutline } from 'ionicons/icons';

interface TargetLocation {
    name: string;
    latlng: [number, number];
    id: string;
    description?: string;
    color: string;
    distanceText?: string;
    distance?: number;
    rank?: number;
    mapsLink?: string;
    mapMarker?: any;
}

interface SearchResult {
    name: string;
    address: string;
    lat: number;
    lng: number;
    isLocal?: boolean;
    id?: string;
}

interface MapZone {
    name: string;
    hash: string;
    center: [number, number];
    zoom?: number;
}

@Component({
    selector: 'app-map-view',
    standalone: true,
    imports: [CommonModule, IonicModule],
    templateUrl: './map-view.component.html',
    styleUrls: ['./map-view.component.css']
})
export class MapViewComponent implements OnInit, OnDestroy, AfterViewInit {
    private bottomSheetService = inject(BottomSheetService);

    private map: any;
    private userMarker: any;
    private searchMarker: any;
    private L: any;
    private ngeohash: any;
    private searchSubscription?: Subscription;
    private sheetStateSubscription?: Subscription;
    private watchId: number | null = null;

    isSearching = false;
    showSuggestions = false;
    currentSearchQuery = '';
    searchError: string | null = null;
    searchResults: SearchResult[] = [];
    userLat: number | null = null;
    userLng: number | null = null;
    userGeoHash: string | null = null;
    errorMessage: string | null = null;

    zones: MapZone[] = [
        { name: 'โซนกลาง', hash: 'w21z', center: [13.7275, 100.7776], zoom: 16 },
        { name: 'โซนตะวันออก', hash: 'w21y', center: [13.7300, 100.7768], zoom: 16 },
        { name: 'โซนริมน้ำ', hash: 'w21x', center: [13.7276, 100.7786], zoom: 16 }
    ];

    private searchSubject = new Subject<string>();
    private currentSheetMode: SheetMode = 'hidden';

    targets: TargetLocation[] = [
        { name: 'อาคารเรียนรวม 12 ชั้น (E12)', latlng: [13.727549228597026, 100.77255458246205], id: 'kmitl_e12', description: 'ตึกเรียนรวมคณะวิศวกรรมศาสตร์', color: '#5b8def' },
        { name: 'คณะเทคโนโลยีสารสนเทศ (IT)', latlng: [13.73110775313755, 100.78104593482931], id: 'kmitl_it', description: 'ตึกกระจกริมน้ำ', color: '#6fcf97' },
        { name: 'สำนักหอสมุดกลาง (KLLC)', latlng: [13.727624181555798, 100.77868310812387], id: 'kmitl_cl', description: 'ศูนย์การเรียนรู้และห้องสมุด', color: '#f2d16b' },
        { name: 'สำนักงานอธิการบดี', latlng: [13.731022304549109, 100.77766077763981], id: 'kmitl_president', description: 'ตึกกรมหลวงนราธิวาสราชนครินทร์', color: '#c792ea' },
        { name: 'หอประชุมเจ้าพระยาสุรวงษ์ฯ', latlng: [13.72664371810848, 100.7792703321349], id: 'kmitl_hall', description: 'หอประชุมใหญ่ สจล.', color: '#56c7d9' },
        { name: 'คณะสถาปัตยกรรมศาสตร์', latlng: [13.725334824782951, 100.77746353790184], id: 'kmitl_arch', description: 'ริมทางรถไฟ', color: '#ff9f6e' },
        { name: 'รพ.พระจอมเกล้าเจ้าคุณทหาร', latlng: [13.732349221023322, 100.789629628721], id: 'kmitl_hospital', description: 'ศูนย์การแพทย์', color: '#ff6f91' },
        { name: 'อาคารพระเทพฯ (ตึกปฏิบัติการ)', latlng: [13.730024512451434, 100.77683801915526], id: 'kmitl_eng_labs', description: 'ศูนย์ปฏิบัติการวิศวกรรม', color: '#84a4fc' },
        { name: 'วิทยาลัยนวัตกรรมการผลิตขั้นสูง', latlng: [13.730062563193098, 100.77542709470409], id: 'kmitl_60th', description: 'อาคารเรียนรวม', color: '#f7a4c0' }
    ];

    constructor(@Inject(PLATFORM_ID) private platformId: Object) {
        addIcons({ businessOutline, locateOutline, navigateOutline, pinOutline });
    }

    ngOnInit(): void {
        this.targets = this.applyRankVisuals([...this.targets]);

        this.searchSubscription = this.searchSubject
            .pipe(debounceTime(300), distinctUntilChanged())
            .subscribe(query => this.performSearch(query));

        this.sheetStateSubscription = this.bottomSheetService.sheetState$.subscribe(state => {
            this.currentSheetMode = state.mode;
            if (state.mode === 'hidden') {
                this.updateBottomSheetList(true);
            }
        });

        this.updateBottomSheetList(true);
    }

    async ngAfterViewInit(): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        const LeafletModule = await import('leaflet');
        this.L = (LeafletModule as any).default || LeafletModule;
        this.ngeohash = await import('ngeohash');

        const iconRetinaUrl = 'assets/leaflet/marker-icon-2x.png';
        const iconUrl = 'assets/leaflet/marker-icon.png';
        const shadowUrl = 'assets/leaflet/marker-shadow.png';
        const DefaultIcon = this.L.Icon.extend({
            options: {
                iconUrl,
                iconRetinaUrl,
                shadowUrl,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            }
        });
        this.L.Marker.prototype.options.icon = new (DefaultIcon as any)();

        this.initMap();
        this.startTracking();
    }

    ngOnDestroy(): void {
        this.searchSubscription?.unsubscribe();
        this.sheetStateSubscription?.unsubscribe();
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
        }
        if (this.map) {
            this.map.remove();
        }
    }

    onSearchInput(query: string): void {
        this.currentSearchQuery = query;
        this.showSuggestions = true;
        if (!query || query.trim().length < 2) {
            this.searchResults = [];
            return;
        }
        this.searchSubject.next(query);
    }

    clearSearch(): void {
        this.currentSearchQuery = '';
        this.searchResults = [];
        this.showSuggestions = false;
        this.searchError = null;
        this.isSearching = false;
        if (this.searchMarker && this.map) {
            this.map.removeLayer(this.searchMarker);
            this.searchMarker = undefined;
        }
    }

    async selectSearchResult(result: SearchResult): Promise<void> {
        this.showSuggestions = false;
        this.currentSearchQuery = result.name;
        const targetId = result.id || `search-${Date.now()}`;
        const target: TargetLocation = {
            name: result.name,
            latlng: [result.lat, result.lng],
            id: targetId,
            description: result.address,
            color: '#ff4f5e',
            mapsLink: this.buildMapsLink(result.lat, result.lng)
        };
        this.onLocationSelect(target);
    }

    async focusOnSelectedZone(hash: string): Promise<void> {
        const zone = this.zones.find(z => z.hash === hash);
        if (!zone || !this.map || !this.L) {
            return;
        }
        this.map.flyTo(zone.center, zone.zoom ?? 16, { duration: 1.1 });
    }

    async onLocationSelect(target: TargetLocation): Promise<void> {
        if (!this.map) {
            return;
        }

        this.map.flyTo(target.latlng, 18, { duration: 1.2 });

        if (this.searchMarker) {
            this.map.removeLayer(this.searchMarker);
            this.searchMarker = undefined;
        }

        const persistedTarget = this.targets.find(t => t.id === target.id);
        const detailTarget = persistedTarget ? persistedTarget : target;

        if (!persistedTarget) {
            this.addSearchMarker(target.latlng, target.name, target.color);
        }

        const detailPayload = {
            ...detailTarget,
            mapsLink: detailTarget.mapsLink ?? this.buildMapsLink(detailTarget.latlng[0], detailTarget.latlng[1])
        };

        this.bottomSheetService.open('location-detail', detailPayload, undefined, 'default');
    }

    focusOnUser(): void {
        if (!this.map || this.userLat === null || this.userLng === null) {
            return;
        }
        this.map.flyTo([this.userLat, this.userLng], 18, { duration: 1.1 });
        this.bottomSheetService.setExpansionState('peek');
    }

    clearSelection(): void {
        this.updateBottomSheetList(true);
    }

    private performSearch(query: string): void {
        this.isSearching = true;
        const lowerQuery = query.toLowerCase();
        const localMatches: SearchResult[] = this.targets
            .filter(target => target.name.toLowerCase().includes(lowerQuery))
            .map(target => ({
                name: target.name,
                address: target.description ?? 'KMITL',
                lat: target.latlng[0],
                lng: target.latlng[1],
                isLocal: true,
                id: target.id
            }));

        this.searchResults = localMatches;
        this.isSearching = false;
    }

    private initMap(): void {
        const host = document.getElementById('map');
        if (!host || !this.L) {
            return;
        }

        const defaultCenter: [number, number] = [13.72766661420566, 100.77253069896474];
        if (this.map) {
            this.map.remove();
        }

        this.map = this.L.map('map', { center: defaultCenter, zoom: 16, zoomControl: false });
        this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        this.targets.forEach(target => {
            const icon = this.createRankedPinIcon(target.color, target.rank ?? 0);
            const marker = this.L.marker(target.latlng, { icon }).addTo(this.map);
            marker.on('click', () => this.onLocationSelect(target));
            target.mapMarker = marker;
        });

        this.map.on('movestart', () => {
            this.bottomSheetService.setExpansionState('peek');
        });

        setTimeout(() => this.map?.invalidateSize(), 300);
    }

    private startTracking(): void {
        if (!navigator.geolocation) {
            this.errorMessage = 'อุปกรณ์ไม่รองรับการระบุตำแหน่ง';
            return;
        }

        const options: PositionOptions = {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 8000
        };

        this.watchId = navigator.geolocation.watchPosition(
            position => {
                if (!this.L) return;
                this.userLat = position.coords.latitude;
                this.userLng = position.coords.longitude;
                this.userGeoHash = this.ngeohash?.encode(this.userLat, this.userLng, 7) ?? null;

                const current = this.L.latLng(this.userLat, this.userLng);

                if (!this.userMarker && this.map) {
                    this.userMarker = this.L.marker(current, { icon: this.createUserIcon() }).addTo(this.map);
                } else if (this.userMarker) {
                    this.userMarker.setLatLng(current);
                }

                this.updateTargetDistances(current);
            },
            error => {
                this.errorMessage = error.message || 'ไม่สามารถรับตำแหน่งได้';
            },
            options
        );
    }

    private updateTargetDistances(userLatLng: any): void {
        if (!this.L) return;
        this.targets.forEach(target => {
            const distanceMeters = userLatLng.distanceTo(this.L.latLng(target.latlng));
            const distanceText = distanceMeters < 1000
                ? `${Math.round(distanceMeters)} ม.`
                : `${(distanceMeters / 1000).toFixed(1)} กม.`;
            target.distance = distanceMeters;
            target.distanceText = distanceText;
        });

        const sortedTargets = [...this.targets]
            .sort((a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER));

        this.targets = this.applyRankVisuals(sortedTargets);

        this.targets.forEach(target => {
            if (target.mapMarker) {
                target.mapMarker.setIcon(this.createRankedPinIcon(target.color, target.rank ?? 0));
            }
        });

        this.updateBottomSheetList();
    }

    private updateBottomSheetList(force = false): void {
        if (!force && this.currentSheetMode === 'location-detail') {
            return;
        }
        if (force) {
            this.targets = this.applyRankVisuals([...this.targets]);
        }
        const listPayload = this.targets.map(target => ({
            ...target,
            mapsLink: target.mapsLink ?? this.buildMapsLink(target.latlng[0], target.latlng[1])
        }));
        const currentState = this.bottomSheetService.getCurrentExpansionState();
        this.bottomSheetService.open('building-list', listPayload, 'สถานที่แนะนำ (KMITL)', currentState);
    }

    private addSearchMarker(position: [number, number], name: string, color: string): void {
        if (!this.map || !this.L) return;
        const icon = this.createPinIcon(color);
        this.searchMarker = this.L.marker(position, { icon })
            .addTo(this.map)
            .bindPopup(`<b>${name}</b>`)
            .openPopup();
    }

    private createPinIcon(color: string): any {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="32" height="32"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
        return this.L.icon({
            iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
            iconSize: [32, 32],
            iconAnchor: [16, 32]
        });
    }

    private createRankedPinIcon(color: string, rank: number): any {
        const numberLabel = rank > 0 ? rank.toString() : '';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><path d="M20 0C10 0 2 8 2 16c0 8 8 22 18 24 10-2 18-16 18-24 0-8-8-16-18-16z" fill="${color}" stroke="white" stroke-width="2"/><text x="20" y="22" font-family="Roboto, sans-serif" font-size="14" fill="white" text-anchor="middle" font-weight="600">${numberLabel}</text></svg>`;
        return this.L.icon({
            iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -36]
        });
    }

    private createUserIcon(): any {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40"><circle cx="12" cy="12" r="11" fill="#4285F4" stroke="white" stroke-width="2"/></svg>`;
        return this.L.icon({
            iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });
    }

    private buildMapsLink(lat: number, lng: number): string {
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }

    private applyRankVisuals(targets: TargetLocation[]): TargetLocation[] {
        const total = targets.length || 1;
        return targets.map((target, index) => {
            const rank = index + 1;
            target.rank = rank;
            target.color = this.getRankedColor(rank, total);
            return target;
        });
    }

    private getRankedColor(rank: number, total: number): string {
        if (total <= 1) {
            return 'hsl(120, 85%, 45%)';
        }
        const ratio = (rank - 1) / (total - 1);
        const hue = 120 - (ratio * 120);
        return `hsl(${hue}, 88%, 48%)`;
    }
}
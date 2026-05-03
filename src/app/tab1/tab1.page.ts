import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  AfterViewInit,
  Inject,
  PLATFORM_ID,
  NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { isPlatformBrowser } from '@angular/common';
import { IonicModule, ModalController, Platform, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { Subscription, interval, of, Subject } from 'rxjs';
import { catchError, timeout, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { UiEventService } from '../services/ui-event';
import { SupabaseService } from '../services/supabase.service';
import { ParkingDetailComponent } from '../modal/parking-detail/parking-detail.component';
import { BookingTypeSelectorComponent } from '../modal/booking-type-selector/booking-type-selector.component';
import { RegisterCodeModalComponent } from '../modal/register-code/register-code-modal.component';

import * as ngeohash from 'ngeohash';
import { ParkingLot, ScheduleItem, UserProfile } from '../data/models';
import { ParkingDataService } from '../services/parking-data.service';
import { ParkingService } from '../services/parking.service';
import { BookmarkService } from '../services/bookmark.service';
import { ReservationService } from '../services/reservation.service';
import { BottomSheetService } from '../services/bottom-sheet.service';

// import buildingFloorData from '../components/floor-plan/e12-floor1.json';

const buildingFloorData = {
  buildingId: 'e12',
  buildingName: 'อาคาร E12',
  floors: []
};

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('sheetContent') sheetContentEl!: ElementRef<HTMLElement>;

  searchQuery = '';
  selectedTab = 'all';
  selectedLocation: 'parking' | 'building' = 'parking';

  allParkingLots: ParkingLot[] = [];
  visibleParkingLots: ParkingLot[] = [];
  filteredParkingLots: ParkingLot[] = [];


  buildingZones: any[] = [];
  allBuildingRooms: any[] = [];
  filteredBuildingRooms: any[] = [];

  userProfile: UserProfile | null = null;


  activeReservation: any = null;
  currentParkingFee: number = 0;
  feeCalcInterval: any;


  userLat = 13.6513;
  userLon = 100.4955;


  private map: any;
  private markers: any[] = [];
  private userMarker: any;
  private geoHashBounds: any;
  private userGeoHash: string | null = null;


  private animationFrameId: any;
  private sheetToggleSub!: Subscription;
  private timeCheckSub!: Subscription;
  private searchSub!: Subscription;
  private userProfileSub!: Subscription;
  private profileIdSub!: Subscription;
  private refreshSub!: Subscription;

  private realtimeTimeout: any;
  private realtimeChannel: any;


  private searchSubject = new Subject<string>();
  isSearching = false;


  sheetLevel = 1;
  currentSheetHeight = 250;
  isDragging = false;
  isSnapping = true;
  startY = 0;
  startHeight = 0;
  startLevel = 1;
  canScroll = false;


  lastY = 0;
  lastTime = 0;
  velocityY = 0;

  isModalOpen = false;

  constructor(
    private modalCtrl: ModalController,
    private uiEventService: UiEventService,
    private platform: Platform,
    private alertCtrl: AlertController,
    private parkingDataService: ParkingDataService,
    private parkingApiService: ParkingService,
    private supabaseService: SupabaseService,
    private reservationService: ReservationService,
    private router: Router,
    private bottomSheetService: BottomSheetService,
    private bookmarkService: BookmarkService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private ngZone: NgZone
  ) { }


  ngOnInit() {
    this.updateSheetHeightByLevel(this.sheetLevel);

    this.sheetToggleSub = this.uiEventService.toggleTab1Sheet$.subscribe(() => {
      requestAnimationFrame(() => {
        this.toggleSheetState();
      });
    });


    this.userProfileSub = this.parkingDataService.userProfile$.subscribe(p => {
      this.userProfile = p;
    });

    this.profileIdSub = this.reservationService.currentProfileId$.subscribe(id => {
      if (id) {
        this.loadBuildingData();
        this.loadRealData();
        this.loadActiveReservation();
      }
    });

    this.refreshSub = this.uiEventService.refreshParkingData$.subscribe(() => {
      console.log('[Tab1] 🔄 Refresh Event Received. Reloading Data...');
      this.loadRealData();
    });

    this.timeCheckSub = interval(60000).subscribe(() => {
      this.updateParkingStatuses();
    });

    this.setupRealtimeSubscription();

    this.searchSub = this.searchSubject.pipe(
      debounceTime(400)
    ).subscribe(() => {
      this.filterData();
      this.isSearching = false;
    });
  }

  ngOnDestroy() {
    if (this.sheetToggleSub) this.sheetToggleSub.unsubscribe();
    if (this.timeCheckSub) this.timeCheckSub.unsubscribe();
    if (this.searchSub) this.searchSub.unsubscribe();


    if (this.userProfileSub) this.userProfileSub.unsubscribe();
    if (this.profileIdSub) this.profileIdSub.unsubscribe();
    if (this.refreshSub) this.refreshSub.unsubscribe();

    if (this.feeCalcInterval) clearInterval(this.feeCalcInterval);
    if (this.realtimeTimeout) clearTimeout(this.realtimeTimeout);

    if (this.realtimeChannel) {
      this.supabaseService.client.removeChannel(this.realtimeChannel);
    }

    if (this.map) {
      this.map.remove();
    }
  }

  async loadActiveReservation() {
    try {

      const reservations = await this.reservationService.getUserReservationsFromEdge();


      this.activeReservation = reservations.find((r: any) =>
        r.status === 'active' || r.status === 'checked_in' || r.status === 'checked_in_pending_payment'
      );

      if (this.activeReservation) {

        this.updateCurrentFee();


        if (this.feeCalcInterval) clearInterval(this.feeCalcInterval);
        this.feeCalcInterval = setInterval(() => {
          this.updateCurrentFee();
        }, 60000);
      } else {
        if (this.feeCalcInterval) clearInterval(this.feeCalcInterval);
        this.currentParkingFee = 0;
      }
    } catch (e) {
      console.error('[Tab1] Error loading active reservation', e);
    }
  }

  async updateCurrentFee() {
    if (this.activeReservation && this.activeReservation.id) {
      const fee = await this.reservationService.getParkingFee(this.activeReservation.id);
      this.currentParkingFee = fee;
    }
  }

  setupRealtimeSubscription() {
    console.log('[Tab1] 🔴 Starting Realtime Subscription...');
    this.realtimeChannel = this.supabaseService.client.channel('parking-channel-multi');

    this.realtimeChannel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload: any) => {
        this.handleRealtimeUpdate();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_lots' }, (payload: any) => {
        this.handleRealtimeUpdate();
      })
      .subscribe((status: any) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Tab1] ✅ Realtime Connection Established (Multi-Table)');
        }
      });
  }

  handleRealtimeUpdate() {

    if (this.realtimeTimeout) {
      clearTimeout(this.realtimeTimeout);
    }

    this.realtimeTimeout = setTimeout(() => {
      console.log('[Tab1] 🔄 Refreshing Data due to Realtime Event...');
      this.loadRealData();
      this.loadActiveReservation();
    }, 1000);
  }

  loadRealData() {
    console.log('[Tab1] 1. Requesting Real Data API...');
    const profileId = this.reservationService.getCurrentProfileId() || this.userProfile?.id || null;
    this.parkingApiService.getSiteBuildings('1', 0, 0, profileId)
      .pipe(
        timeout(3000),
        catchError(err => {
          console.error('[Tab1] API Error or Timeout.', err);
          return of([]);
        })
      )
      .subscribe({
        next: async (realLots) => {
          if (realLots) {
            console.log('[Tab1] Applying Real Data (Count: ' + realLots.length + ')');


            const bookmarkedIds = await this.bookmarkService.getBookmarkedBuildingIds();
            realLots.forEach(lot => {
              lot.isBookmarked = bookmarkedIds.includes(lot.id);
            });

            this.allParkingLots = realLots;
            this.processScheduleData();
            this.updateParkingStatuses();
            this.calculateDistances();
            this.filterData();

            if (this.filteredParkingLots.length === 0) {
              console.warn('[Tab1] ⚠️ View is empty after API update.');
            }

          } else {
            console.warn('[Tab1] ⚠️ API returned empty/error.');
            this.allParkingLots = [];
            this.filterData();
          }
        },
        error: (err) => {
          console.error('[Tab1] Subscribe Error:', err);
          this.allParkingLots = [];
          this.filterData();
        }
      });
  }

  loadBuildingData() {

    this.buildingZones = [{ id: 'all', name: 'All Buildings' }];


    const singleBuilding = {
      id: buildingFloorData.buildingId,
      name: buildingFloorData.buildingName,
      type: 'Building',
      zoneId: 'all',
      zoneName: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี',
      color: '#1a73e8',
      floorCount: buildingFloorData.floors.length
    };

    this.allBuildingRooms = [singleBuilding];
  }

  filterData() {
    let results = this.allParkingLots;

    results = results.filter(lot => {
      const cat = (lot.category || 'parking').toLowerCase();
      const selectedCat = (this.selectedLocation || 'parking').toLowerCase();

      if (selectedCat === 'parking') {
        const hasCapacity = lot.capacity && (lot.capacity.normal > 0 || lot.capacity.ev > 0 || lot.capacity.motorcycle > 0);
        if (!hasCapacity) {
          return false;
        }
      }
      return cat === selectedCat;
    });

    if (this.selectedTab !== 'all') {
      if (this.selectedLocation === 'parking') {
        results = results.filter((lot) => {
          if (lot.supportedTypes && Array.isArray(lot.supportedTypes)) {
            return lot.supportedTypes.includes(this.selectedTab);
          }
          if (lot.capacity) {
            if (this.selectedTab === 'normal') return lot.capacity.normal > 0;
            if (this.selectedTab === 'ev') return lot.capacity.ev > 0;
            if (this.selectedTab === 'motorcycle') return lot.capacity.motorcycle > 0;
          }
          return false;
        });
      } else {
        this.filteredBuildingRooms = this.selectedTab === 'all'
          ? this.allBuildingRooms
          : this.allBuildingRooms.filter((room: any) => room.zoneId === this.selectedTab);
      }
    } else {
      if (this.selectedLocation === 'building') {
        this.filteredBuildingRooms = this.allBuildingRooms;
      }
    }

    if (this.searchQuery.trim() !== '') {
      const q = this.searchQuery.toLowerCase();
      if (this.selectedLocation === 'parking') {
        results = results.filter((lot) => lot.name.toLowerCase().includes(q));
      } else {
        this.filteredBuildingRooms = this.filteredBuildingRooms.filter((room: any) => room.name.toLowerCase().includes(q));
      }
    }


    results.forEach(lot => {
      (lot as any).displayAvailable = this.getDisplayAvailable(lot);
      (lot as any).displayStatusText = this.getStatusText(lot.status);
      (lot as any).displaySupportedTypes = this.getSupportedTypesText(lot.supportedTypes || []);
    });

    this.filteredParkingLots = results;
    this.visibleParkingLots = results;

    this.updateParkingStatuses();
    this.updateMarkers();
  }

  trackByLotId(index: number, lot: any): string {
    return lot.id;
  }

  trackByRoomId(index: number, room: any): string {
    return room.id;
  }

  onSearch() {
    this.isSearching = true;
    this.searchSubject.next(this.searchQuery);
  }
  onTabChange() { this.filterData(); }

  async openRegisterCodeModal() {
    const modal = await this.modalCtrl.create({
      component: RegisterCodeModalComponent,
      breakpoints: [0, 0.75],
      initialBreakpoint: 0.75,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {

      if (data.type === 'parking') {
        this.router.navigate(['/tabs/tab2']);
        return;
      }


      let accessData: any = null;

      try {
        const { data: ticketData, error } = await this.supabaseService.client
          .from('access_tickets')
          .select('building_id, floor, room_id')
          .eq('invite_code', data.code)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        accessData = ticketData;
      } catch (err) {
        console.error('Failed to fetch access ticket detail:', err);
      }

      const buildingId = accessData?.building_id || 'E12';

      this.router.navigate(['/tabs/tab4'], {
        queryParams: { buildingId }
      });

      setTimeout(() => {
        this.bottomSheetService.open(
          'access-list',
          undefined,
          'สิทธิ์เข้าอาคารของคุณ',
          'peek'
        );
      }, 400);
    }
  }

  goToProfile() {
    this.router.navigate(['/tabs/tab3']);
  }

  locationChanged(ev: any) {
    this.selectedLocation = ev.detail.value;
    this.selectedTab = 'all';
    this.filterData();
  }


  // async openBuildingDetails(building: any) {
  //   const modal = await this.modalCtrl.create({
  //     component: BuildingDetailComponent,
  //     componentProps: {
  //       lot: building
  //     },
  //     initialBreakpoint: 1,
  //     breakpoints: [0, 1],
  //     backdropDismiss: true,
  //     showBackdrop: true,
  //     cssClass: 'detail-sheet-modal',
  //   });
  //   return await modal.present();
  // }





  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      await this.initMap();
      this.updateMarkers();



    }
  }







  private async initMap() {
    const L = await import('leaflet');


    const iconUrl = 'assets/icon/favicon.png';
    const DefaultIcon = L.Icon.extend({
      options: {
        iconUrl,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -15],
      }
    });
    L.Marker.prototype.options.icon = new DefaultIcon();


    const centerLat = 13.651336;
    const centerLng = 100.496472;

    this.map = L.map('map', {
      center: [centerLat, centerLng],
      zoom: 16,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    setTimeout(() => { this.map.invalidateSize(); }, 500);
  }

  private createPinIcon(L: any, color: string, text: string = '') {
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.5" width="40px" height="40px">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <text x="12" y="11.5" font-family="Arial, sans-serif" font-weight="bold" font-size="7" fill="white" stroke="none" text-anchor="middle">${text}</text>
      </svg>
    `;

    return L.divIcon({
      html: svgContent,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });
  }

  async updateMarkers() {
    if (!this.map) return;
    const L = await import('leaflet');


    this.markers.forEach(m => this.map.removeLayer(m));
    this.markers = [];


    this.visibleParkingLots.forEach((lot, index) => {
      if (lot.lat && lot.lng) {

        const color = lot.distanceColor || '#6c757d';


        const rankNumber = (index + 1).toString();

        const icon = this.createPinIcon(L, color, rankNumber);

        const marker = L.marker([lot.lat, lot.lng], { icon: icon })
          .addTo(this.map)
          .bindPopup(`<b>${lot.name}</b><br>ว่าง: ${this.getDisplayAvailable(lot)} คัน`);

        marker.on('click', () => {
          this.viewLotDetails(lot);
        });

        this.markers.push(marker);
      }
    });
  }


  public focusOnUser() {
    if (!navigator.geolocation) {
      this.showLocationError('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง');
      return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;


      this.userGeoHash = ngeohash.encode(lat, lng, 7);


      this.userLat = lat;
      this.userLon = lng;
      this.calculateDistances();
      this.filterData();

      if (this.map) {
        const L = await import('leaflet');

        this.map.flyTo([lat, lng], 17);


        if (!this.userMarker) {
          const userIcon = L.divIcon({
            html: `<div style="width: 15px; height: 15px; background: #4285F4; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 5px rgba(0,0,0,0.3);"></div>`,
            className: '',
            iconSize: [15, 15]
          });
          this.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(this.map);
        } else {
          this.userMarker.setLatLng([lat, lng]);
        }


        if (this.geoHashBounds) {
          this.map.removeLayer(this.geoHashBounds);
        }


        const boundsArray = ngeohash.decode_bbox(this.userGeoHash);
        const bounds: [[number, number], [number, number]] = [[boundsArray[0], boundsArray[1]], [boundsArray[2], boundsArray[3]]];


        this.geoHashBounds = L.rectangle(bounds, {
          color: '#4285f4',
          weight: 1,
          fillOpacity: 0.1,
          fillColor: '#4285f4'
        }).addTo(this.map);
      }
    }, (err) => {

      console.error('Error getting location', err);

      let message = 'ไม่สามารถระบุตำแหน่งได้';
      if (err.code === 1) {
        message = 'กรุณาเปิดสิทธิ์การเข้าถึงตำแหน่ง (Location Permission) ที่การตั้งค่าของเบราว์เซอร์หรืออุปกรณ์';
      } else if (err.code === 2) {
        message = 'สัญญาณ GPS ขัดข้อง ไม่สามารถระบุตำแหน่งได้';
      } else if (err.code === 3) {
        message = 'หมดเวลาในการค้นหาตำแหน่ง ลองใหม่อีกครั้ง';
      }

      this.showLocationError(message);

    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  }


  async showLocationError(msg: string) {
    const alert = await this.alertCtrl.create({
      header: 'แจ้งเตือนพิกัด',
      message: msg,
      buttons: ['ตกลง'],
      mode: 'ios'
    });
    await alert.present();
  }








  getPixelHeightForLevel(level: number): number {
    const platformHeight = this.platform.height();
    if (level === 0) return 80;
    if (level === 1) return platformHeight * 0.35;
    if (level === 2) return platformHeight * 0.85;
    return 80;
  }

  updateSheetHeightByLevel(level: number) {
    this.currentSheetHeight = this.getPixelHeightForLevel(level);
    this.canScroll = level === 2;
    if (level === 0 && this.sheetContentEl?.nativeElement) {
      this.sheetContentEl.nativeElement.scrollTop = 0;
    }
  }

  startDrag(ev: any) {
    const touch = ev.touches ? ev.touches[0] : ev;
    this.startY = touch.clientY;


    this.lastY = this.startY;
    this.lastTime = Date.now();
    this.velocityY = 0;

    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    sheet.classList.remove('snapping');
    this.isSnapping = false;
    this.startHeight = sheet.offsetHeight;
    this.startLevel = this.sheetLevel;
    this.isDragging = false;


    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('mousemove', this.dragMove);
      window.addEventListener('mouseup', this.endDrag);
      window.addEventListener('touchmove', this.dragMove, { passive: false });
      window.addEventListener('touchend', this.endDrag);
    });
  }

  dragMove = (ev: any) => {
    const touch = ev.touches ? ev.touches[0] : ev;
    const currentY = touch.clientY;
    const now = Date.now();


    if (this.lastTime > 0) {
      const dt = now - this.lastTime;
      const dy = currentY - this.lastY;
      if (dt > 0) {

        this.velocityY = (this.velocityY * 0.4) + ((dy / dt) * 0.6);
      }
    }
    this.lastY = currentY;
    this.lastTime = now;

    const contentEl = this.sheetContentEl.nativeElement;
    const isAtTop = contentEl.scrollTop <= 0;
    const isMaxLevel = this.sheetLevel === 2;

    if (isMaxLevel && !isAtTop) {
      this.startY = currentY;
      this.startHeight = this.getPixelHeightForLevel(2);
      return;
    }

    const diff = this.startY - currentY;
    if (!this.isDragging && Math.abs(diff) < 5) return;

    if (!isMaxLevel || (isMaxLevel && isAtTop && diff < 0)) {
      if (ev.cancelable) ev.preventDefault();
      this.isDragging = true;
      let newHeight = this.startHeight + diff;
      const maxHeight = this.platform.height() - 40;
      newHeight = Math.max(80, Math.min(newHeight, maxHeight));
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = requestAnimationFrame(() => {
        const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
        if (sheet) {
          sheet.style.height = `${newHeight}px`;
        }
      });
    }
  };

  endDrag = (ev: any) => {
    window.removeEventListener('mousemove', this.dragMove);
    window.removeEventListener('mouseup', this.endDrag);
    window.removeEventListener('touchmove', this.dragMove);
    window.removeEventListener('touchend', this.endDrag);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }


    this.ngZone.run(() => {
      if (this.isDragging) {
        const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
        const finalH = sheet.offsetHeight;
        const totalDragged = finalH - this.startHeight;
        const platformHeight = this.platform.height();
        const dragThreshold = platformHeight * 0.05;

        const h0 = this.getPixelHeightForLevel(0);
        const h1 = this.getPixelHeightForLevel(1);
        const h2 = this.getPixelHeightForLevel(2);


        const isFlickUp = this.velocityY < -0.6;
        const isFlickDown = this.velocityY > 0.6;

        if (isFlickUp) {

          if (this.startLevel === 0) this.sheetLevel = 1;
          else if (this.startLevel === 1) this.sheetLevel = 2;
        } else if (isFlickDown) {

          if (this.startLevel === 2) this.sheetLevel = 1;
          else if (this.startLevel === 1) this.sheetLevel = 0;
        } else {

          if (totalDragged > dragThreshold) {

            if (this.startLevel === 0) {
              this.sheetLevel = (finalH > h1 + dragThreshold) ? 2 : 1;
            } else if (this.startLevel === 1) {
              this.sheetLevel = 2;
            }
          } else if (totalDragged < -dragThreshold) {

            if (this.startLevel === 2) {
              this.sheetLevel = (finalH < h1 - dragThreshold) ? 0 : 1;
            } else if (this.startLevel === 1) {
              this.sheetLevel = 0;
            }
          } else {

            this.sheetLevel = this.startLevel;
          }
        }

        this.snapToCurrentLevel();
      } else {
        this.snapToCurrentLevel();
      }
      setTimeout(() => { this.isDragging = false; }, 100);
    });
  };

  snapToCurrentLevel() {
    this.isSnapping = true;
    this.updateSheetHeightByLevel(this.sheetLevel);



    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    if (sheet) {
      sheet.classList.add('snapping');
      sheet.style.height = `${this.currentSheetHeight}px`;
    }
  }

  toggleSheetState() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isDragging = false;
    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    if (sheet) {
      sheet.classList.remove('snapping');
      void sheet.offsetWidth;
      sheet.classList.add('snapping');
      this.isSnapping = true;
    }
    if (this.sheetLevel === 0) {
      this.sheetLevel = 1;
    } else {
      this.sheetLevel = 0;
    }
    this.updateSheetHeightByLevel(this.sheetLevel);
  }


  processScheduleData() {
    this.allParkingLots.forEach(lot => {
      if (lot.schedule && lot.schedule.length > 0) {
        lot.schedule.forEach(sch => this.parseCronToScheduleData(sch));
      }
    });
  }

  updateParkingStatuses() {
    const now = new Date();
    this.allParkingLots.forEach((lot) => {
      if (!lot.schedule || lot.schedule.length === 0) {
        lot.hours = 'เปิด 24 ชั่วโมง';
        return;
      }
      let isOpenNow = false;
      let displayTexts: string[] = [];
      lot.schedule.forEach((sch) => {
        const isActive = this.checkIsScheduleActive(sch, now);
        if (isActive) isOpenNow = true;
        const dayText = this.formatDaysText(sch.days);
        displayTexts.push(`${dayText} ${sch.open_time} - ${sch.close_time}`);
      });
      const hoursText = displayTexts.join(', ');

      const currentAvailable = this.getDisplayAvailable(lot);

      if (!isOpenNow) {
        lot.status = 'closed';
        lot.hours = `ปิด (${hoursText})`;
      } else {
        lot.hours = `เปิดอยู่ (${hoursText})`;
        const totalCap = this.getDisplayCapacity(lot);

        if (currentAvailable <= 0) lot.status = 'full';
        else if (totalCap > 0 && (currentAvailable / totalCap) < 0.1) lot.status = 'low';
        else lot.status = 'available';
      }
    });
  }

  parseCronToScheduleData(sch: ScheduleItem) {
    const openParts = sch.cron.open.split(' ');
    const closeParts = sch.cron.close.split(' ');
    if (openParts.length >= 5 && closeParts.length >= 5) {
      sch.open_time = `${this.pad(openParts[1])}:${this.pad(openParts[0])}`;
      sch.close_time = `${this.pad(closeParts[1])}:${this.pad(closeParts[0])}`;
      sch.days = this.parseCronDays(openParts[4]);
    }
  }

  parseCronDays(dayPart: string): string[] {
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysIndex: number[] = [];
    if (dayPart === '*') return [...dayMap];
    if (dayPart.includes('-')) {
      const [start, end] = dayPart.split('-').map(Number);
      let current = start;
      let loopCount = 0;
      while (current !== end && loopCount < 8) {
        daysIndex.push(current % 7);
        current = (current + 1) % 7;
        loopCount++;
      }
      daysIndex.push(end % 7);
    } else if (dayPart.includes(',')) {
      dayPart.split(',').forEach((d) => daysIndex.push(Number(d) % 7));
    } else {
      daysIndex.push(Number(dayPart) % 7);
    }
    return [...new Set(daysIndex.map((i) => dayMap[i]))];
  }

  checkIsScheduleActive(sch: ScheduleItem, now: Date): boolean {
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = dayMap[now.getDay()];
    if (!sch.days.includes(currentDayName)) return false;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [openH, openM] = sch.open_time.split(':').map(Number);
    const startMinutes = openH * 60 + openM;
    const [closeH, closeM] = sch.close_time.split(':').map(Number);
    let endMinutes = closeH * 60 + closeM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }

  pad(val: string | number): string {
    return val.toString().padStart(2, '0');
  }

  formatDaysText(days: string[]): string {
    const thaiDays: { [key: string]: string } = {
      sunday: 'อา.', monday: 'จ.', tuesday: 'อ.', wednesday: 'พ.',
      thursday: 'พฤ.', friday: 'ศ.', saturday: 'ส.'
    };
    if (days.length === 7) return 'ทุกวัน';
    return days.map(d => thaiDays[d]).join(',');
  }

  getTypeName(type: string): string {
    switch (type) {
      case 'normal': return 'Car';
      case 'ev': return 'EV';
      case 'motorcycle': return 'Motorcycle';
      default: return type;
    }
  }

  getSupportedTypesText(types: string[]): string {
    if (!types || types.length === 0) return '-';
    const names = types.map(t => {
      if (t === 'normal') return 'รถยนต์ทั่วไป';
      if (t === 'ev') return 'รถ EV';
      if (t === 'motorcycle') return 'รถจักรยานยนต์';
      return t;
    });
    return names.join(', ');
  }


  calculateDistances() {
    this.allParkingLots.forEach(lot => {

      const lotLat = lot.lat || lot.mapX;
      const lotLng = lot.lng || lot.mapY;

      if (lotLat && lotLng) {

        const distKm = this.calculateDistance(this.userLat, this.userLon, lotLat, lotLng);

        lot.distance = Math.round(distKm * 1000);
      } else {
        lot.distance = 999999;
      }
    });


    this.allParkingLots.sort((a, b) => (a.distance || 0) - (b.distance || 0));


    const validLots = this.allParkingLots.filter(l => l.distance !== 999999);
    const totalValid = validLots.length;

    this.allParkingLots.forEach((lot, index) => {
      if (lot.distance === 999999) {
        lot.distanceColor = 'hsl(214, 0%, 75%)';
      } else {

        const ratio = totalValid > 1 ? index / (totalValid - 1) : 0;


        const saturation = Math.floor(82 - (ratio * 82));


        const lightness = Math.floor(51 + (ratio * 24));

        lot.distanceColor = `hsl(214, ${saturation}%, ${lightness}%)`;
      }
    });
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async toggleBookmark(lot: ParkingLot, event: Event) {
    event.stopPropagation();
    if (!lot?.id) return;

    try {
      if (lot.isBookmarked) {
        await this.bookmarkService.removeBookmark(lot.id);
        lot.isBookmarked = false;
      } else {
        await this.bookmarkService.addBookmark(lot.id);
        lot.isBookmarked = true;
      }
    } catch (e) {
      console.error('Error toggling bookmark', e);
    }
  }

  async viewLotDetails(lot: ParkingLot) {

    // if (lot.category === 'building') {

    //   const modal = await this.modalCtrl.create({
    //     component: BuildingDetailComponent,
    //     componentProps: {
    //       lot: lot
    //     },
    //     initialBreakpoint: 1,
    //     breakpoints: [0, 1],
    //     backdropDismiss: true,
    //     showBackdrop: true,
    //     cssClass: 'detail-sheet-modal',
    //   });
    //   await modal.present();
    //   return;
    // }


    this.isModalOpen = true;


    this.isSnapping = true;
    this.sheetLevel = 0;
    this.updateSheetHeightByLevel(0);

    const typeModal = await this.modalCtrl.create({
      component: BookingTypeSelectorComponent,
      cssClass: 'auto-height-modal',
      initialBreakpoint: 0.65,
      breakpoints: [0, 0.65, 1],
      showBackdrop: true,
      backdropDismiss: true
    });

    await typeModal.present();

    const { data, role } = await typeModal.onDidDismiss();


    if (role !== 'confirm' || !data) {
      this.isModalOpen = false;
      return;
    }

    const selectedBookingMode = data.bookingMode;


    this.isSnapping = true;
    this.sheetLevel = 0;
    this.updateSheetHeightByLevel(0);

    if (this.map && lot.lat && lot.lng) {
      this.map.flyTo([lot.lat, lot.lng], 18, {
        animate: true,
        duration: 1.0
      });
    }

    const modal = await this.modalCtrl.create({
      component: ParkingDetailComponent,
      componentProps: {
        lot: lot,
        initialType: this.selectedTab === 'all' ? 'normal' : this.selectedTab,
        bookingMode: selectedBookingMode
      },
      initialBreakpoint: 1,
      breakpoints: [0, 1],
      backdropDismiss: true,
      showBackdrop: true,
      cssClass: 'detail-sheet-modal',
    });
    await modal.present();







    const detailRes = await modal.onDidDismiss();
    this.isModalOpen = false;
  }

  getMarkerColor(available: number | null, capacity: number) {
    if (available === null || available === 0) return 'danger';
    if (available / capacity < 0.3) return 'warning';
    return 'success';
  }
  getStatusColor(status: string) {
    switch (status) {
      case 'available': return 'success';
      case 'low': return 'warning';
      case 'full': case 'closed': return 'danger';
      default: return 'medium';
    }
  }
  getStatusText(status: string) {
    switch (status) {
      case 'available': return 'ว่าง';
      case 'low': return 'ใกล้เต็ม';
      case 'full': return 'เต็ม';
      case 'closed': return 'ปิด';
      default: return 'N/A';
    }
  }

  getDisplayCapacity(lot: ParkingLot): number {
    if (!lot.capacity) return 0;
    if (this.selectedTab === 'all') {
      return (lot.capacity.normal || 0) + (lot.capacity.ev || 0) + (lot.capacity.motorcycle || 0);
    }

    return (lot.capacity as Record<string, number>)[this.selectedTab] || 0;
  }

  getDisplayAvailable(lot: ParkingLot): number {
    if (!lot.available) return 0;
    if (this.selectedTab === 'all') {
      return (lot.available.normal || 0) + (lot.available.ev || 0) + (lot.available.motorcycle || 0);
    }

    return (lot.available as Record<string, number>)[this.selectedTab] || 0;
  }



}
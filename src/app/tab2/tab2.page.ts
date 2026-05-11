import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Booking } from '../data/models';
import { ParkingDataService } from '../services/parking-data.service';
import { ReservationService } from '../services/reservation.service';
import { ReservationDetailComponent } from '../modal/reservation-detail/reservation-detail.component';
import { SupabaseService } from '../services/supabase.service';
// import { BuildingDetailComponent } from '../modal/building-detail/building-detail.component';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs/operators';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page implements OnInit, OnDestroy {

  
  selectedMonth: string = 'all';
  selectedCategory: string = 'all';

  
  searchQuery: string = '';
  showSearch: boolean = false;
  isSearching: boolean = false;

  private searchSubject = new Subject<string>();
  private searchSub!: Subscription;
  private subs = new Subscription();

  
  monthOptions: { value: string, label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' }
  ];

  categoryOptions = [
    { value: 'all', label: 'รายการทั้งหมด' },
    { value: 'hourly', label: 'รายชั่วโมง' },
    { value: 'flat_24h', label: 'เหมาจ่าย 24 ชม.' },
    { value: 'monthly_regular', label: 'รายเดือน' },
  ];

  
  selectedStatusSegment: string = 'in_progress'; 

  
  displayBookings: Booking[] = [];

  
  isExpanded: boolean = false;

  allBookings: Booking[] = [];
  private reservationBookings: Booking[] = [];
  private accessPassBookings: Booking[] = [];

  
  reservationsSubscription: any;

  
  isLoading: boolean = false;

  constructor(
    private parkingService: ParkingDataService,
    private reservationService: ReservationService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private supabaseService: SupabaseService,
  ) { }
  
  ngOnInit() {
    this.subs.add(
      this.parkingService.bookings$.subscribe(bookings => {
        this.reservationBookings = bookings || [];
        this.mergeAllBookings();
      })
    );

    this.subs.add(
      this.reservationService.currentProfileId$.pipe(
        distinctUntilChanged(),
        skip(1)
      ).subscribe(async (userId: string) => {
        if (userId) {
          await this.loadRealReservations();
          await this.loadAccessPassBookings(userId);

          if (this.reservationsSubscription) {
            this.reservationsSubscription.unsubscribe();
            this.reservationsSubscription = null;
          }
          this.setupRealtimeSubscription();
        }
      })
    );

    this.searchSub = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(() => {
      this.updateFilter();
      this.isSearching = false;
    });
  }

  ngOnDestroy() {
    if (this.searchSub) {
      this.searchSub.unsubscribe();
    }
    this.subs.unsubscribe();
    if (this.reservationsSubscription) {
      this.reservationsSubscription.unsubscribe();
      this.reservationsSubscription = null;
    }
  }

  async ionViewWillEnter() {
    const profileId = this.reservationService.getCurrentProfileId();
    if (profileId) {
      await this.loadRealReservations();
      await this.loadAccessPassBookings(profileId);
    }
    this.setupRealtimeSubscription();
  }

  ionViewWillLeave() {
    if (this.reservationsSubscription) {
      this.reservationsSubscription.unsubscribe();
      this.reservationsSubscription = null;
    }
  }

  setupRealtimeSubscription() {
    if (this.reservationsSubscription) {
      return;
    }

    this.reservationsSubscription = this.reservationService.subscribeToUserReservations(() => {
      this.loadRealReservations();
    });
  }

  async loadRealReservations(event?: any) {
    try {
      if (!event) {
        this.isLoading = true;
      }
      const reservations = await this.reservationService.getUserReservationsFromEdge();

      if (reservations) {
        const mappedBookings: Booking[] = reservations.map((r: any) => {
          const lot = this.parkingService.getParkingLotById(r.parking_site_id);

          let status: any = 'pending_payment';
          let statusLabel = 'รอชำระเงิน';

          switch (r.status) {
            case 'pending':
              status = 'pending';
              statusLabel = 'กำลังตรวจสอบรายการ';
              break;
            case 'pending_payment':
              status = 'pending_payment';
              statusLabel = 'รอชำระเงิน';
              break;
            case 'pending_invite':
              status = 'pending_invite';
              statusLabel = 'รอเข้าใช้งาน (ส่งคำเชิญแล้ว)';
              break;
            case 'checked_in_pending_payment':
              status = 'checked_in_pending_payment';
              statusLabel = 'กำลังจอด (รอชำระเงิน)';
              break;
            case 'confirmed':
              status = 'confirmed';
              statusLabel = 'เสร็จสิ้น';
              break;
            case 'checked_in':
            case 'active':
              status = 'active';
              statusLabel = 'กำลังจอด';
              break;
            case 'checked_out':
            case 'completed':
              status = 'completed';
              statusLabel = 'เสร็จสิ้น';
              break;
            case 'cancelled':
              status = 'cancelled';
              statusLabel = 'ยกเลิกแล้ว';
              break;
            default:
              status = r.status;
              statusLabel = r.status;
          }

          let zoneLabel = '-';
          let floorLabel = '-';
          let buildingLabel = '-';
          let derivedPlaceName = null;

          if (r.slot_id) {
            const parts = r.slot_id.split('-');
            if (parts.length >= 2) {
              const buildingId = `${parts[0]}-${parts[1]}`;
              const derivedLot = this.parkingService.getParkingLotById(buildingId);
              if (derivedLot) {
                derivedPlaceName = derivedLot.name;
              }
            }

            if (parts.length >= 5) {
              buildingLabel = parts[1];
              floorLabel = parts[2];
              const zoneNum = parseInt(parts[3], 10);
              if (!isNaN(zoneNum) && zoneNum >= 1 && zoneNum <= 26) {
                zoneLabel = String.fromCharCode(64 + zoneNum);
              } else {
                zoneLabel = parts[3];
              }
            }
          }

          let placeName = derivedPlaceName || (lot ? lot.name : (r.parking_site_id || 'Unknown Location'));
          const bookingType = r.booking_type || 'hourly';
          const bookingDate = (r.start_time.includes('Z') || r.start_time.includes('+')) ? new Date(r.start_time) : new Date(r.start_time + 'Z');
          const endDate = (r.end_time.includes('Z') || r.end_time.includes('+')) ? new Date(r.end_time) : new Date(r.end_time + 'Z');

          let periodLabel: string | undefined = undefined;
          if (bookingType === 'monthly_regular' || bookingType === 'monthly_night') {
            const startStr = bookingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const calculatedEndDate = new Date(bookingDate);
            calculatedEndDate.setMonth(calculatedEndDate.getMonth() + 1);
            const endStr = calculatedEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            periodLabel = `${startStr} - ${endStr}`;
          }

          let dateLabel: string | undefined = undefined;
          if (bookingType === 'hourly' || bookingType === 'flat_24h' || bookingType === 'daily') {
            const isSameDay = bookingDate.getDate() === endDate.getDate() &&
              bookingDate.getMonth() === endDate.getMonth() &&
              bookingDate.getFullYear() === endDate.getFullYear();
            if (!isSameDay) {
              const startStr = bookingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              const endStr = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              dateLabel = `${startStr} - ${endStr}`;
            }
          }

          return {
            id: r.id,
            placeName: placeName,
            locationDetails: `ตึก ${buildingLabel} ชั้น ${floorLabel} | โซน ${zoneLabel} | ${r.slot_id || '-'}`,
            bookingTime: bookingDate,
            endTime: endDate,
            status: status,
            statusLabel: statusLabel,
            price: r.total_amount || 0,
            carBrand: r.car_plate?.startsWith('PRK-') ? 'รอข้อมูล' : (r.cars?.model || 'ไม่ระบุ'),
            licensePlate: r.car_plate?.startsWith('PRK-') ? `รหัสเชิญ: ${r.car_plate}` : (r.car_plate ? `${r.car_plate}${r.cars?.province ? ' ' + r.cars.province : ''}` : 'รอระบุทะเบียน'),
            bookingType: bookingType,
            periodLabel: periodLabel,
            building: buildingLabel,
            floor: floorLabel,
            zone: zoneLabel,
            slot: r.slot_id || '-',
            vehicleType: r.vehicle_type,
            carId: r.car_id,
            dateLabel: dateLabel,
            reservedAt: (r.reserved_at && (r.reserved_at.includes('Z') || r.reserved_at.includes('+'))) ? new Date(r.reserved_at) : (r.reserved_at ? new Date(r.reserved_at + 'Z') : new Date()),
            lat: lot?.lat || lot?.mapX,
            lng: lot?.lng || lot?.mapY
          } as Booking;
        });

        this.reservationBookings = mappedBookings;
        this.mergeAllBookings();
      }
    } catch (error) {
      console.error('Error loading real reservations:', error);
    } finally {
      this.isLoading = false;
      if (event) {
        event.target.complete();
      }
    }
  }

  doRefresh(event: any) {
    this.loadRealReservations(event);
    const profileId = this.reservationService.getCurrentProfileId();
    if (profileId) {
      this.loadAccessPassBookings(profileId);
    }
  }

  segmentChanged(event: any) {
    this.selectedStatusSegment = event.detail.value;
    this.updateFilter();
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) {
      this.searchQuery = '';
      this.isSearching = false;
      this.updateFilter();
    }
  }

  onSearch() {
    this.isSearching = true;
    this.searchSubject.next(this.searchQuery);
  }

  selectMonth(val: string) {
    this.selectedMonth = val;
    this.updateFilter();
  }

  selectCategory(val: string) {
    this.selectedCategory = val;
    this.updateFilter();
  }

  getSelectedMonthLabel(): string {
    const opt = this.monthOptions.find(o => o.value === this.selectedMonth);
    return opt ? opt.label : 'เดือนทั้งหมด';
  }

  getSelectedCategoryLabel(): string {
    const opt = this.categoryOptions.find(o => o.value === this.selectedCategory);
    return opt ? opt.label : 'ประเภททั้งหมด';
  }

  generateMonthOptions() {
    const months = new Set<string>();
    this.allBookings.forEach(b => {
      const d = new Date(b.bookingTime);
      if (isNaN(d.getTime())) return;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      months.add(`${yyyy}-${mm}`);
    });

    this.monthOptions = [{ value: 'all', label: 'ทั้งหมด' }];
    Array.from(months).sort((a, b) => b.localeCompare(a)).forEach(m => {
      const [yyyy, mm] = m.split('-');
      const d = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
      const thaiMonth = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
      this.monthOptions.push({ value: m, label: thaiMonth });
    });
  }

  updateFilter() {
    let filtered = this.allBookings.filter(b => {
      let statusMatch = false;
      if (this.selectedStatusSegment === 'in_progress') {
        statusMatch = ['active', 'pending_payment', 'pending', 'pending_invite', 'checked_in_pending_payment'].includes(b.status);
      } else if (this.selectedStatusSegment === 'cancelled') {
        statusMatch = b.status === 'cancelled';
      } else {
        statusMatch = b.status === 'completed' || b.status === 'confirmed';
      }

      let monthMatch = true;
      if (this.selectedMonth !== 'all') {
        const d = new Date(b.bookingTime);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const key = `${yyyy}-${mm}`;
        monthMatch = key === this.selectedMonth;
      }

      let catMatch = true;
      if (this.selectedCategory !== 'all') {
        if (b.itemKind === 'access_pass') {
          catMatch = false;
        } else {
          catMatch = b.bookingType === (this.selectedCategory as any);
        }
      }

      let searchMatch = true;
      if (this.searchQuery.trim() !== '') {
        const q = this.searchQuery.toLowerCase().trim();
        searchMatch = !!(
          (b.placeName && b.placeName.toLowerCase().includes(q)) ||
          (b.carId && b.carId.toLowerCase().includes(q)) ||
          (b.licensePlate && b.licensePlate.toLowerCase().includes(q)) ||
          (b.building && b.building.toLowerCase().includes(q)) ||
          (b.zone && b.zone.toLowerCase().includes(q)) ||
          (b.slot && b.slot.toLowerCase().includes(q))
        );
      }

      return statusMatch && monthMatch && catMatch && searchMatch;
    });

    filtered.sort((a, b) => new Date(a.bookingTime).getTime() - new Date(b.bookingTime).getTime());
    this.displayBookings = filtered;
  }

  private mergeAllBookings() {
    this.allBookings = [...(this.reservationBookings || []), ...(this.accessPassBookings || [])];

    this.allBookings.sort((a, b) => {
      const timeA = (a.reservedAt || a.bookingTime)?.getTime?.() ?? 0;
      const timeB = (b.reservedAt || b.bookingTime)?.getTime?.() ?? 0;
      return timeB - timeA;
    });

    this.generateMonthOptions();
    this.updateFilter();
  }

  private async loadAccessPassBookings(profileId: string) {
    try {
      const { data: accessRows, error } = await this.supabaseService.client
        .from('user_door_access')
        .select('door_id, valid_until, granted_at, is_granted')
        .eq('profile_id', profileId)
        .eq('is_granted', true);

      if (error) throw error;

      const rows = (accessRows || []).filter((r: any) => !!r?.door_id);
      if (!rows.length) {
        this.accessPassBookings = [];
        this.mergeAllBookings();
        return;
      }

      const bestByDoor = new Map<string, { validUntil: string | null; grantedAt: string | null }>();
      for (const r of rows) {
        const doorId = String(r.door_id);
        const prev = bestByDoor.get(doorId);
        const nextValidUntil: string | null = r.valid_until ?? null;
        const nextGrantedAt: string | null = r.granted_at ?? null;

        if (!prev) {
          bestByDoor.set(doorId, { validUntil: nextValidUntil, grantedAt: nextGrantedAt });
          continue;
        }

        const prevValidUntil = prev.validUntil;
        const mergedValidUntil = (prevValidUntil === null || nextValidUntil === null)
          ? null
          : (new Date(nextValidUntil).getTime() > new Date(prevValidUntil).getTime() ? nextValidUntil : prevValidUntil);

        const prevGrantedAt = prev.grantedAt;
        const mergedGrantedAt = (!prevGrantedAt || (nextGrantedAt && new Date(nextGrantedAt).getTime() > new Date(prevGrantedAt).getTime()))
          ? nextGrantedAt
          : prevGrantedAt;

        bestByDoor.set(doorId, { validUntil: mergedValidUntil, grantedAt: mergedGrantedAt });
      }

      const doorIds = Array.from(bestByDoor.keys());
      const { data: ticketRows, error: ticketError } = await this.supabaseService.client
        .from('access_tickets')
        .select('room_id, floor, building_id, expires_at')
        .in('room_id', doorIds);

      if (ticketError) throw ticketError;

      const ticketByDoor = new Map<string, any>();
      for (const t of (ticketRows || [])) {
        const roomId = t?.room_id;
        if (!roomId) continue;
        const prev = ticketByDoor.get(roomId);
        if (!prev) {
          ticketByDoor.set(roomId, t);
          continue;
        }
        const prevExpiry = prev.expires_at ? new Date(prev.expires_at).getTime() : -1;
        const nextExpiry = t.expires_at ? new Date(t.expires_at).getTime() : -1;
        if (nextExpiry > prevExpiry) {
          ticketByDoor.set(roomId, t);
        }
      }

      type BuildingGroup = {
        buildingId: string;
        doorIds: string[];
        roomLabels: string[];
        anyActive: boolean;
        expiresAt: Date | null;
        grantedAt: Date | null;
      };

      const groups = new Map<string, BuildingGroup>();
      const now = Date.now();

      for (const doorId of doorIds) {
        const ticket = ticketByDoor.get(doorId);
        const buildingId = ticket?.building_id;
        if (!buildingId) continue;

        const access = bestByDoor.get(doorId);
        const validUntilIso: string | null = access?.validUntil ?? (ticket?.expires_at ?? null);
        const grantedAtIso: string | null = access?.grantedAt ?? null;

        const isActive = (validUntilIso === null) || (new Date(validUntilIso).getTime() >= now);

        const label = ticket?.floor
          ? `ชั้น ${ticket.floor} | ${doorId}`
          : `ห้อง ${doorId}`;

        const existing = groups.get(buildingId);
        const grantedAt = grantedAtIso ? new Date(grantedAtIso) : null;
        const validUntil = validUntilIso ? new Date(validUntilIso) : null;

        if (!existing) {
          groups.set(buildingId, {
            buildingId,
            doorIds: [doorId],
            roomLabels: [label],
            anyActive: isActive,
            expiresAt: validUntilIso === null ? null : validUntil,
            grantedAt,
          });
        } else {
          existing.doorIds.push(doorId);
          existing.roomLabels.push(label);
          existing.anyActive = existing.anyActive || isActive;

          if (existing.expiresAt !== null) {
            if (validUntilIso === null) {
              existing.expiresAt = null;
            } else if (validUntil) {
              existing.expiresAt = existing.expiresAt
                ? (validUntil.getTime() < existing.expiresAt.getTime() ? validUntil : existing.expiresAt)
                : validUntil;
            }
          }

          if (grantedAt) {
            existing.grantedAt = existing.grantedAt
              ? (grantedAt.getTime() > existing.grantedAt.getTime() ? grantedAt : existing.grantedAt)
              : grantedAt;
          }
        }
      }

      const mapped = Array.from(groups.values()).map((g) => {
        const lot = this.parkingService.getParkingLotById(g.buildingId);

        
        
        
        let computedExpiresAt: Date | null = null;
        if (g.doorIds?.length) {
          let hasUnlimited = false;
          const expiryTimes: number[] = [];

          for (const doorId of g.doorIds) {
            const access = bestByDoor.get(doorId);
            const ticket = ticketByDoor.get(doorId);
            const validUntilIso: string | null = access?.validUntil ?? (ticket?.expires_at ?? null);
            if (validUntilIso === null) {
              hasUnlimited = true;
              break;
            }
            const t = new Date(validUntilIso).getTime();
            if (!isNaN(t)) {
              expiryTimes.push(t);
            }
          }

          if (!hasUnlimited && expiryTimes.length) {
            const picked = g.anyActive ? Math.min(...expiryTimes) : Math.max(...expiryTimes);
            computedExpiresAt = new Date(picked);
          }
        }

        const count = g.doorIds.length;
        const roomPreview = g.roomLabels.slice(0, 2).join(' | ') + (count > 2 ? ` +${count - 2}` : '');

        const status: Booking['status'] = g.anyActive ? 'active' : 'completed';
        const statusLabel = 'บัตรผ่านเข้าอาคาร';
        const locationDetails = g.anyActive
          ? `ใช้งานได้ • ${count} พื้นที่`
          : `หมดอายุแล้ว • ${count} พื้นที่`;

        const issuedAt = g.grantedAt || new Date();

        return {
          id: `access_pass:${g.buildingId}`,
          itemKind: 'access_pass',
          placeName: lot?.name || `อาคาร ${g.buildingId}`,
          locationDetails,
          bookingTime: issuedAt,
          endTime: computedExpiresAt || issuedAt,
          status,
          statusLabel,
          price: 0,
          carBrand: '-',
          licensePlate: '-',
          bookingType: 'hourly',
          building: '-',
          floor: '-',
          zone: '-',
          slot: '-',
          lat: lot?.lat || lot?.mapX,
          lng: lot?.lng || lot?.mapY,
          reservedAt: issuedAt,
          passBuildingId: g.buildingId,
          passDoorIds: g.doorIds,
          passDoorCount: count,
          passExpiresAt: computedExpiresAt,
          passRoomPreview: roomPreview,
        } as Booking;
      });

      this.accessPassBookings = mapped;
      this.mergeAllBookings();
    } catch (e) {
      console.error('Error loading access passes:', e);
      this.accessPassBookings = [];
      this.mergeAllBookings();
    }
  }

  getPassExpiresLabel(item: Booking): string {
    if (!item?.passExpiresAt) return 'ไม่กำหนดวันหมดอายุ';
    const d = item.passExpiresAt;
    return `หมดอายุ ${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  getPassExpiresTimeLabel(item: Booking): string {
    if (!item?.passExpiresAt) return '';
    const d = item.passExpiresAt;
    const hh = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `${hh} น.`;
  }

  getBookingTypeLabel(type: string | undefined): string {
    switch (type) {
      case 'hourly': return 'รายชั่วโมง';
      case 'flat_24h': return 'เหมาจ่าย 24 ชม.';
      case 'monthly_regular': return 'รายเดือน';
      case 'monthly_night': return 'รายเดือน (กลางคืน)';
      default: return 'ทั่วไป';
    }
  }

  getVehicleTypeLabel(type: string | undefined): string {
    switch (type) {
      case 'car': return 'รถยนต์';
      case 'motorcycle': return 'รถจักรยานยนต์';
      case 'ev': return 'รถยนต์ไฟฟ้า (EV)';
      case 'other': return 'อื่นๆ';
      default: return type || 'ไม่ระบุ';
    }
  }

  getBookingTypeClass(type: string | undefined): string {
    switch (type) {
      case 'hourly': return 'bg-blue-50 text-blue-600 border border-blue-100';
      case 'flat_24h': return 'bg-green-50 text-green-600 border border-green-100';
      case 'monthly_regular':
      case 'monthly_night': return 'bg-purple-50 text-purple-600 border border-purple-100';
      default: return 'bg-gray-50 text-gray-600 border border-gray-100';
    }
  }

  getStatusClass(item: Booking): string {
    if (item.status === 'pending') return 'text-sky-500';
    if (item.status === 'pending_invite') return 'text-purple-600 font-bold';
    if (item.status === 'pending_payment') return 'text-orange-500';
    if (item.status === 'checked_in_pending_payment') return 'text-orange-600 font-bold italic';
    if (item.status === 'active') return 'text-green-600';
    if (item.status === 'confirmed') return 'text-[var(--ion-color-primary)]';
    if (item.status === 'completed') return 'text-gray-500';
    if (item.status === 'cancelled') return 'text-red-500';
    return '';
  }

  toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  openMap(lat?: number, lng?: number) {
    if (!lat || !lng) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  }

  async handleFooterClick(item: Booking) {
    if (item?.itemKind === 'access_pass') {
      await this.openAccessPassDetail(item);
      return;
    }

    const modal = await this.modalCtrl.create({
      component: ReservationDetailComponent,
      componentProps: { booking: item },
      initialBreakpoint: 1,
      breakpoints: [0, 1],
      backdropDismiss: true,
      showBackdrop: true,
      cssClass: 'detail-sheet-modal',
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {
      if (data.action === 'cancel') {
        try {
          await this.reservationService.updateReservationStatusv2(item.id, 'cancelled');
          const toast = await this.toastCtrl.create({
            message: 'ยกเลิกการจองสำเร็จ',
            duration: 2000,
            color: 'success',
            position: 'top'
          });
          toast.present();
          this.loadRealReservations();
        } catch (e) {
          console.error(e);
        }
      } else if (data.action === 'checkout') {
        try {
          await this.reservationService.updateReservationStatusv2(item.id, 'confirmed');
          const toast = await this.toastCtrl.create({
            message: `ยืนยันสถานะสำเร็จ`,
            duration: 3000,
            color: 'success',
            position: 'top'
          });
          toast.present();
          this.loadRealReservations();
        } catch (e) {
          console.error(e);
        }
      } else if (data.action === 'receipt') {
        this.loadRealReservations();
      }
    }
  }

  private async openAccessPassDetail(item: Booking) {
    const buildingId = item?.passBuildingId;
    if (!buildingId) return;
    const lot = this.parkingService.getParkingLotById(buildingId);
    if (!lot) return;

    // const modal = await this.modalCtrl.create({
    //   component: BuildingDetailComponent,
    //   componentProps: { lot },
    //   initialBreakpoint: 1,
    //   breakpoints: [0, 1],
    //   backdropDismiss: true,
    //   showBackdrop: true,
    //   cssClass: 'detail-sheet-modal',
    // });
    // await modal.present();
  }
}

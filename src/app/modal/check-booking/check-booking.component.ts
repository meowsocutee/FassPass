import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { ReservationService } from '../../services/reservation.service';
import { ParkingService } from '../../services/parking.service';
import { ParkingDataService } from '../../services/parking-data.service';
import { SupabaseService } from '../../services/supabase.service';
import { Vehicle } from '../../data/models';

@Component({
  selector: 'app-check-booking',
  templateUrl: './check-booking.component.html',
  styleUrls: ['./check-booking.component.scss'],
  standalone: false,
})
export class CheckBookingComponent implements OnInit, OnDestroy {
  @Input() data: any;

  durationText: string = '';
  timeDisplay: string = '';
  totalPrice: number = 0;
  hourlyRate: number = 20; 
  isCarOccupied: boolean = false;

  floors: string[] = ['Floor 1', 'Floor 2', 'Floor 3'];
  availableZones: string[] = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E'];

  assignedFloor: string = '';
  assignedZone: string = '';

  parkingData: { [floor: string]: { [zone: string]: any[] } } = {};

  zonePriority: { [key: string]: number } = {
    'Zone A': 1, 'Zone B': 2, 'Zone C': 3, 'Zone D': 4, 'Zone E': 5
  };
  floorPriority: { [key: string]: number } = {
    'Floor 1': 1, 'Floor 2': 2, 'Floor 3': 3
  };

  paymentMethods = [
    { id: 'promptpay', name: 'PromptPay', icon: 'qr-code-outline', color: 'text-blue-600', bg: 'bg-blue-50' },
    { id: 'creditcard', name: 'Credit Card', icon: 'card-outline', color: 'text-purple-600', bg: 'bg-purple-50' },
    { id: 'wallet', name: 'TrueMoney', icon: 'wallet-outline', color: 'text-orange-600', bg: 'bg-orange-50' },
    { id: 'gateway', name: 'ชำระเงินออนไลน์ (GATEWAY)', icon: 'globe-outline', color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { id: 'pay_later', name: 'จ่ายทีหลัง (Pay Later)', icon: 'time-outline', color: 'text-gray-600', bg: 'bg-gray-100' }
  ];
  selectedPaymentMethod: string = 'promptpay';

  
  currentStep: number = 1;
  promptPayRef: string = '';
  promptPayUrl: string | null = null;
  isLoadingPayment: boolean = false;
  createdReservationId: string | null = null;
  paymentSubscription: any;

  
  cardNumber: string = '';
  cardExpiry: string = '';
  cardCvv: string = '';
  cardName: string = '';
  walletPhone: string = '';

  userVehicles: Vehicle[] = [];
  selectedCarId: number | string = '';

  bookingType: 'self' | 'invite' = 'self';
  generatedInviteCode: string = '';
  userRole: string = 'User'; 

  constructor(
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private reservationService: ReservationService,
    private parkingService: ParkingService,
    private parkingDataService: ParkingDataService,
    private supabaseService: SupabaseService,
    private ngZone: NgZone
  ) { }

  ngOnInit() {
    if (this.data && this.data.lotPrice !== undefined) {
      this.hourlyRate = this.data.lotPrice;
    }

    this.calculateDurationAndPrice();
    this.generatePromptPayRef();

    this.parkingDataService.vehicles$.subscribe(vehicles => {
      this.userVehicles = vehicles || [];
      if (this.userVehicles.length > 0) {
        const defaultVehicle = this.userVehicles.find(v => v.isDefault);
        this.selectedCarId = defaultVehicle ? defaultVehicle.id : this.userVehicles[0].id;
      }
    });

    if (!this.data.selectedFloors) this.data.selectedFloors = [];
    if (!this.data.selectedZones) this.data.selectedZones = [];

    if (typeof this.data.selectedFloors === 'string') {
      this.data.selectedFloors = this.data.selectedFloors === 'any'
        ? [...this.floors]
        : this.data.selectedFloors.split(',').map((s: string) => s.trim());
    }
    if (typeof this.data.selectedZones === 'string') {
      this.data.selectedZones = this.data.selectedZones === 'any'
        ? [...this.availableZones]
        : this.data.selectedZones.split(',').map((s: string) => s.trim());
    }

    if (this.data.selectedFloors.length > 0) {
      this.floors = [...this.data.selectedFloors];
    }
    if (this.data.selectedZones.length > 0) {
      this.availableZones = [...this.data.selectedZones];
    }

    this.initMockParkingData();

    if (this.data.isRandomSystem || !this.data.selectedSlotId) {
      this.randomizeSlot();
    } else {
      this.assignedFloor = this.data.selectedFloor || (this.data.selectedFloors.length === 1 ? this.data.selectedFloors[0] : '');
      this.assignedZone = this.data.selectedZone || (this.data.selectedZones.length === 1 ? this.data.selectedZones[0] : '');
    }

    
    setTimeout(() => this.checkCurrentCarAvailability(), 500);
    this.fetchUserRole();
  }

  ngOnDestroy() {
    if (this.paymentSubscription) {
      this.supabaseService.client.removeChannel(this.paymentSubscription);
    }
  }

  async fetchUserRole() {
    try {
      const { data: { user } } = await this.supabaseService.client.auth.getUser();
      if (user) {
        const { data } = await this.supabaseService.client
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (data && data.role) {
          this.userRole = data.role;
        }
      }
    } catch (e) {
      console.error('Error fetching role:', e);
    }
  }

  initMockParkingData() {
    const siteId = this.data.siteId || '1';

    this.floors.forEach(floor => {
      this.parkingData[floor] = {};
      this.availableZones.forEach((zone) => {
        const zoneChar = zone.replace('Zone ', '').trim();
        const zoneIdx = zoneChar.charCodeAt(0) - 64;
        const slots = [];
        const totalSlots = 12;
        const floorParts = floor.split('-');
        const fSite = floorParts.length >= 3 ? floorParts[0] : siteId;
        const fBuild = floorParts.length >= 3 ? floorParts[1] : '1';
        const fFloor = floorParts.length >= 3 ? floorParts[2] : (this.floors.indexOf(floor) + 1).toString();

        for (let i = 1; i <= totalSlots; i++) {
          const slotId = `${fSite}-${fBuild}-${zoneIdx}-${fFloor}-${i}`;
          slots.push({
            i: i,
            label: slotId
          });
        }
        this.parkingData[floor][zone] = slots;
      });
    });
  }

  getZoneAvailability(zone: string): number {
    let total = 0;
    this.data.selectedFloors.forEach((floor: string) => {
      if (this.parkingData[floor] && this.parkingData[floor][zone]) {
        total += this.parkingData[floor][zone].length;
      }
    });
    return total;
  }

  toggleFloor(floor: string) {
    const idx = this.data.selectedFloors.indexOf(floor);
    if (idx > -1) this.data.selectedFloors.splice(idx, 1);
    else this.data.selectedFloors.push(floor);
  }

  selectAllFloors() {
    this.data.selectedFloors = [...this.floors];
  }

  clearAllFloors() {
    this.data.selectedFloors = [];
    this.data.selectedZones = [];
  }

  isFloorSelected(floor: string): boolean {
    return this.data.selectedFloors.includes(floor);
  }

  isAllFloorsSelected(): boolean {
    return this.floors.length > 0 && this.floors.every(f => this.data.selectedFloors.includes(f));
  }

  toggleZone(zone: string) {
    if (this.data.selectedFloors.length === 0) {
      this.presentToast('กรุณาเลือกชั้น (Floor) อย่างน้อย 1 ชั้นก่อนเลือกโซน');
      return;
    }
    const idx = this.data.selectedZones.indexOf(zone);
    if (idx > -1) this.data.selectedZones.splice(idx, 1);
    else this.data.selectedZones.push(zone);
  }

  selectAllZones() {
    if (this.data.selectedFloors.length === 0) {
      this.presentToast('กรุณาเลือกชั้น (Floor) อย่างน้อย 1 ชั้นก่อนเลือกโซน');
      return;
    }
    this.data.selectedZones = [...this.availableZones];
  }

  clearAllZones() {
    this.data.selectedZones = [];
  }

  isZoneSelected(zone: string): boolean {
    return this.data.selectedZones.includes(zone);
  }

  isAllZonesSelected(): boolean {
    return this.availableZones.length > 0 && this.availableZones.every(z => this.data.selectedZones.includes(z));
  }

  async randomizeSlot() {
    if (this.data.selectedFloors.length === 0 || this.data.selectedZones.length === 0) {
      if (this.data.selectedFloors.length === 0 && this.data.selectedZones.length === 0) {
      } else {
        this.presentToast('กรุณาเลือกชั้นและโซนอย่างน้อย 1 รายการเพื่อสุ่ม');
      }
      this.data.selectedSlotId = null;
      this.assignedFloor = '';
      this.assignedZone = '';
      return;
    }

    
    
    const zoneIds = this.data.selectedZoneIds || [];
    if (zoneIds.length === 0) {
      
      console.warn('No real Zone IDs provided to CheckBooking. Cannot find real slot.');
      this.presentToast('ไม่พบข้อมูลโซนที่ถูกต้อง (No Zone IDs)');
      return;
    }

    const start = new Date(this.data.startSlot.dateTime);
    
    const end = new Date(this.data.endSlot.dateTime);

    
    
    const targetZoneId = zoneIds[0];

    
    const targetFloorName = this.data.selectedFloors[0] || 'Unknown Floor';
    const targetZoneName = this.data.selectedZones[0] || 'Unknown Zone';

    try {
      const result = await (this.parkingService).findBestAvailableSlot(targetZoneId, start, end).toPromise();

      if (result && result.slot_id) {
        this.data.selectedSlotId = result.slot_id;
        this.assignedFloor = targetFloorName;
        this.assignedZone = targetZoneName;

        
        this.presentToast(`ระบบเลือกให้: ${targetFloorName} - ${targetZoneName} (${result.slot_name || result.slot_id})`);

      } else {
        this.data.selectedSlotId = null;
        this.assignedFloor = 'เต็ม';
        this.assignedZone = 'เต็ม';
        this.presentToast('ไม่พบช่องจอดว่างในช่วงเวลาที่เลือก (Zone Full)');
      }

    } catch (err) {
      console.error('Error finding best slot:', err);
      this.presentToast('เกิดข้อผิดพลาดในการค้นหาช่องจอด');
    }
  }

  isNextDay(start: any, end: any): boolean {
    if (!start || !end) return false;
    const s = new Date(start); s.setHours(0, 0, 0, 0);
    const e = new Date(end); e.setHours(0, 0, 0, 0);
    return e.getTime() > s.getTime();
  }

  calculateDurationAndPrice() {
    if (this.data?.startSlot?.dateTime && this.data?.endSlot?.dateTime) {
      const start = new Date(this.data.startSlot.dateTime).getTime();
      
      const end = new Date(this.data.endSlot.dateTime).getTime();
      const diffMs = end - start;
      const roundedHours = Math.ceil(diffMs / (1000 * 60 * 60)); 

      const diffHrs = Math.floor((diffMs / (1000 * 60 * 60)));
      const diffMins = Math.round(((diffMs % (1000 * 60 * 60)) / (1000 * 60)));

      let durationStr = '';
      if (diffHrs > 0) durationStr += `${diffHrs} ชม. `;
      if (diffMins > 0) durationStr += `${diffMins} นาที`;
      if (diffMs === 0) durationStr = '1 ชม.';

      this.durationText = durationStr || '1 ชม.';
      this.totalPrice = roundedHours * this.hourlyRate;

      
      const startDate = new Date(this.data.startSlot.dateTime);
      const endDate = new Date(end);

      const pad = (n: number) => n < 10 ? '0' + n : n;
      this.timeDisplay = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())} - ${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;

      
      if (this.data && this.data.price !== undefined) {
        this.totalPrice = this.data.price;
      } else {
        const mode = this.data.bookingMode || 'daily';
        if (mode === 'monthly') {
          this.totalPrice = 1500;
        } else if (mode === 'monthly_night') {
          this.totalPrice = 1200;
        } else if (mode === 'flat24') {
          this.totalPrice = this.hourlyRate * 10;
        } else {
          this.totalPrice = Math.max(0, roundedHours * this.hourlyRate);
        }
      }

      
      const modeText = this.data.bookingMode || 'daily';
      if (modeText === 'monthly') {
        this.durationText = 'รายเดือน (1 เดือน)';
      } else if (modeText === 'monthly_night') {
        this.durationText = 'รายเดือน (เฉพาะกลางคืน)';
      } else if (modeText === 'flat24') {
        this.durationText = 'เหมาจ่าย 24 ชม.';
      }
    }
  }



  selectPaymentMethod(methodId: string) {
    this.selectedPaymentMethod = methodId;
  }

  generatePromptPayRef() {
    const randomAuth = Math.floor(100000 + Math.random() * 900000);
    this.promptPayRef = `REF-${randomAuth}`;
  }

  async presentToast(message: string) {
    const toast = await this.toastCtrl.create({
      message: message, duration: 2000, color: 'dark', position: 'bottom',
    });
    toast.present();
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }

  back() {
    if (this.currentStep === 2) {
      this.currentStep = 1;
    } else {
      this.dismiss();
    }
  }

  async confirm() {
    if (this.isCarOccupied) {
      this.presentToast('รถคันนี้มีการจองในช่วงเวลานี้แล้ว กรุณาเปลี่ยนรถหรือเวลา');
      return;
    }

    if (this.currentStep === 1) {
      if (this.selectedPaymentMethod === 'gateway' || this.selectedPaymentMethod === 'promptpay') {
        try {
          // Create reservation in DB first to get a real UUID
          const dbReservation = await this.createReservationInDB();
          console.log('Created Reservation response:', dbReservation);
          
          let extractedId: string | null = null;
          
          if (typeof dbReservation === 'string') {
            extractedId = dbReservation;
          } else if (dbReservation && typeof dbReservation === 'object') {
             // Look for common ID fields
             extractedId = dbReservation.id || dbReservation.reservation_id || dbReservation.new_id || dbReservation.uuid || dbReservation[0]?.id || dbReservation[0]?.reservation_id;
             
             // If still not found, try to find any UUID in the object values
             if (!extractedId) {
               const values = Object.values(dbReservation);
               for (const val of values) {
                 if (typeof val === 'string' && val.length === 36 && val.includes('-')) {
                   extractedId = val;
                   break;
                 }
               }
             }
          }
          
          this.createdReservationId = extractedId;
          
          if (!this.createdReservationId) {
            throw new Error('ไม่พบ ID: ' + JSON.stringify(dbReservation));
          }

          this.currentStep = 2;
          await this.fetchPaymentGateway(this.createdReservationId);
        } catch (e: any) {
          console.error(e);
          this.presentToast('ไม่สามารถจองได้: ' + (e.message || 'กรุณาลองใหม่'));
        }
      } else {
        this.currentStep = 2;
      }
      return;
    }

    
    const isPayLater = this.selectedPaymentMethod === 'pay_later';
    const selectedCar = this.bookingType === 'invite' ? null : this.selectedCarInfo;
    const isInvite = this.bookingType === 'invite';
    const finalData = {
      ...this.data,
      selectedFloors: [this.assignedFloor],
      selectedZones: [this.assignedZone],
      totalPrice: this.totalPrice,
      paymentMethod: this.selectedPaymentMethod,
      status: isPayLater ? 'pending_payment' : 'pending',
      car_id: isInvite ? null : this.selectedCarId,
      car_plate: isInvite ? 'INVITATION' : (selectedCar ? selectedCar.licensePlate : ''),
      isInvite: isInvite,
      alreadyCreatedInDB: !!this.createdReservationId,
      dbReservationId: this.createdReservationId
    };
    this.modalCtrl.dismiss({ confirmed: true, data: finalData, action: isPayLater ? 'pay_later' : 'pay_now' }, 'confirm');
  }

  async createReservationInDB() {
    const isInvite = this.bookingType === 'invite';
    const selectedCar = isInvite ? null : this.selectedCarInfo;
    
    // Create a mock Booking object expected by createReservationv2
    const mockBooking: any = {
      bookingTime: new Date(this.data.startSlot.dateTime),
      endTime: new Date(this.data.endSlot.dateTime),
      status: 'pending_payment',
      carId: isInvite ? null : this.selectedCarId,
      licensePlate: isInvite ? 'INVITATION' : (selectedCar ? selectedCar.licensePlate : ''),
      bookingType: this.data.bookingMode || 'daily'
    };

    const profileId = this.reservationService.getCurrentProfileId();
    const siteId = this.data.siteId || '1';
    
    return await this.reservationService.createReservationv2(
      mockBooking,
      profileId,
      siteId,
      this.assignedFloor,
      this.data.selectedSlotId
    );
  }

  async fetchPaymentGateway(reservationId: string) {
    this.isLoadingPayment = true;
    try {
      const amountToCharge = this.totalPrice > 20 ? this.totalPrice : 20; // Omise minimum is 20 THB

      const { data, error } = await this.supabaseService.client.functions.invoke('create-promptpay', {
        body: {
          reservation_id: reservationId,
          amount: amountToCharge
        }
      });

      if (error) throw error;
      
      if (data?.source?.scannable_code?.image?.download_uri) {
         this.promptPayUrl = data.source.scannable_code.image.download_uri;
         
         // Start listening for payment success via Webhook
         this.subscribeToPaymentStatus();
      } else {
         throw new Error('No QR Code found in response');
      }
    } catch (e) {
      console.error('Payment API Error:', e);
      this.presentToast('ไม่สามารถสร้าง QR Code ได้ (กรุณาเช็ค OMISE_SECRET_KEY)');
    } finally {
      this.isLoadingPayment = false;
    }
  }

  subscribeToPaymentStatus() {
    if (!this.createdReservationId) return;

    // Listen to changes on the reservations table for this specific ID
    this.paymentSubscription = this.supabaseService.client
      .channel(`payment_status_${this.createdReservationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reservations',
          filter: `id=eq.${this.createdReservationId}`
        },
        (payload: any) => {
          console.log('Realtime reservation update:', payload);
          // When the Omise webhook updates the status to 'paid' (or whatever you use)
          if (payload.new.status === 'paid' || payload.new.status === 'success' || payload.new.status === 'confirmed') {
            this.ngZone.run(() => {
              this.handlePaymentSuccess();
            });
          }
        }
      )
      .subscribe();
  }

  handlePaymentSuccess() {
    if (this.paymentSubscription) {
      this.supabaseService.client.removeChannel(this.paymentSubscription);
    }
    
    this.presentToast('ชำระเงินสำเร็จ! กำลังยืนยันการจอง...');
    
    // Automatically dismiss and proceed as if they clicked Confirm
    const isInvite = this.bookingType === 'invite';
    const selectedCar = isInvite ? null : this.selectedCarInfo;
    
    const finalData = {
      ...this.data,
      selectedFloors: [this.assignedFloor],
      selectedZones: [this.assignedZone],
      totalPrice: this.totalPrice,
      paymentMethod: this.selectedPaymentMethod,
      status: 'confirmed',
      car_id: isInvite ? null : this.selectedCarId,
      car_plate: isInvite ? 'INVITATION' : (selectedCar ? selectedCar.licensePlate : ''),
      isInvite: isInvite,
      alreadyCreatedInDB: true,
      dbReservationId: this.createdReservationId
    };
    
    // Dismiss the modal with success state, returning to parking-detail
    this.modalCtrl.dismiss({ confirmed: true, data: finalData, action: 'pay_now' }, 'confirm');
  }

  get selectedCarInfo(): Vehicle | undefined {
    return this.userVehicles.find(v => v.id === this.selectedCarId);
  }

  selectCar(id: string | number) {
    this.selectedCarId = id;
    this.checkCurrentCarAvailability();
    const popover = document.querySelector('ion-popover.vehicle-popover') as any;
    if (popover && popover.dismiss) popover.dismiss();
  }

  async checkCurrentCarAvailability() {
    if (!this.selectedCarId || !this.data?.startSlot?.dateTime || !this.data?.endSlot?.dateTime) return;
    
    try {
      const start = new Date(this.data.startSlot.dateTime);
      const end = new Date(this.data.endSlot.dateTime);
      
      this.isCarOccupied = await this.reservationService.checkCarOverlap(this.selectedCarId, start, end);
      if (this.isCarOccupied) {
        console.warn('Selected car is already occupied during this period');
      }
    } catch (e) {
      console.error('Error checking car availability:', e);
    }
  }

  getTypeName(type: string): string {
    switch (type) {
      case 'normal': return 'รถยนต์ทั่วไป';
      case 'ev': return 'รถยนต์ EV';
      case 'motorcycle': return 'รถจักรยานยนต์';
      default: return type || 'รถยนต์ทั่วไป';
    }
  }

  getModeLabel(mode: string): string {
    switch (mode) {
      case 'monthly': return 'รายเดือน';
      case 'monthly_night': return 'รายเดือน Night';
      case 'flat24': return 'เหมา 24 ชม.';
      default: return 'รายชั่วโมง (' + this.hourlyRate + ' บ./ชม.)';
    }
  }
}
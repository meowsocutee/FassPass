import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ModalController, ToastController, LoadingController, AlertController, IonicSafeString } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Booking } from '../../data/models';
import { ReservationService } from '../../services/reservation.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { LprService, LprResult } from '../../services/lpr.service';
import { firstValueFrom } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';

@Component({
    selector: 'app-reservation-detail',
    templateUrl: './reservation-detail.component.html',
    standalone: false
})
export class ReservationDetailComponent implements OnInit, OnDestroy {
    @Input() booking!: Booking;

    internalStatus: string = '';
    statusLabel: string = '';
    isScanning: boolean = false;
    lastScanResult: LprResult | null = null;

    private realtimeChannel: RealtimeChannel | null = null;

    constructor(
      private modalCtrl: ModalController,
      private reservationService: ReservationService,
      private authService: AuthService,
      private supabaseService: SupabaseService,
      private toastCtrl: ToastController,
      private loadingCtrl: LoadingController,
      private alertCtrl: AlertController,
      private lprService: LprService
    ) { }

    ngOnInit() {
        this.internalStatus = this.booking.status;
        this.updateStaticData();

        this.fetchCurrentFee();
        this.setupRealtimeListener();
    }

    setupRealtimeListener() {
        
        this.realtimeChannel = this.supabaseService.client
            .channel(`e-stamp-updates-${this.booking.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*', 
                    schema: 'public',
                    table: 'e_stamps',
                    filter: `reservation_id=eq.${this.booking.id}` 
                },
                (payload) => {
                    console.log('[ReservationDetail] Realtime update detected:', payload);
                    
                    this.fetchCurrentFee();
                }
            )
            .subscribe();
    }

    async fetchCurrentFee() {
        if (this.internalStatus === 'active' || this.internalStatus === 'checked_in' || this.internalStatus === 'checked_in_pending_payment') {
            try {
                const fee = await this.reservationService.getParkingFee(this.booking.id);
                this.booking.price = fee;
            } catch (e) {
                console.error('Error fetching live fee:', e);
            }
        }
    }

    ngOnDestroy() {
        if (this.realtimeChannel) {
            this.supabaseService.client.removeChannel(this.realtimeChannel);
        }
    }

    dismiss() {
        this.modalCtrl.dismiss();
    }

    updateStaticData() {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in':
                this.statusLabel = 'กำลังจอด';
                break;
            case 'confirmed':
                this.statusLabel = 'เสร็จสิ้น';
                break;
            case 'pending':
                this.statusLabel = 'กำลังตรวจสอบรายการ';
                break;
            case 'pending_payment':
                this.statusLabel = 'รอชำระเงิน';
                break;
            case 'checked_in_pending_payment':
                this.statusLabel = 'กำลังจอด (รอชำระเงิน)';
                break;
            case 'completed':
            case 'checked_out':
                this.statusLabel = 'เสร็จสิ้น';
                break;
            case 'cancelled':
                this.statusLabel = 'ยกเลิกแล้ว';
                break;
            default:
                this.statusLabel = this.booking.statusLabel || this.internalStatus;
        }
    }


    getDotColor(): string {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in': return 'bg-blue-500';
            case 'confirmed': return 'bg-green-500';
            case 'pending': return 'bg-amber-500';
            case 'pending_payment': 
            case 'checked_in_pending_payment': return 'bg-orange-500';
            case 'completed':
            case 'checked_out': return 'bg-green-500';
            case 'cancelled': return 'bg-red-500';
            default: return 'bg-gray-400';
        }
    }

    getTextColor(): string {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in': return 'text-blue-500';
            case 'confirmed': return 'text-green-500';
            case 'pending': return 'text-amber-500';
            case 'pending_payment': 
            case 'checked_in_pending_payment': return 'text-orange-500';
            case 'completed':
            case 'checked_out': return 'text-green-500';
            case 'cancelled': return 'text-red-500';
            default: return 'text-gray-500';
        }
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
            default: return type || 'รถยนต์';
        }
    }

    openMap() {
        if (this.booking.lat && this.booking.lng) {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${this.booking.lat},${this.booking.lng}`;
            window.open(url, '_blank');
        }
    }

    handleCancel() {
        this.modalCtrl.dismiss({ action: 'cancel' }, 'confirm');
    }

    handleCheckout() {
        this.modalCtrl.dismiss({ action: 'checkout' }, 'confirm');
    }

    handleReceipt() {
        this.modalCtrl.dismiss({ action: 'receipt' }, 'confirm');
    }

    async handleSimulateCheckIn() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_in');
            this.internalStatus = 'checked_in';
            this.booking.status = 'checked_in';
            this.updateStaticData();
            this.fetchCurrentFee();

            const toast = await this.toastCtrl.create({
                message: 'จำลองการเช็คอินสำเร็จ',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error simulating check-in:', error);
        }
    }

    async handleCheckoutConfirm() {
        try {
            
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'confirmed');
            this.internalStatus = 'confirmed';
            this.booking.status = 'confirmed';
            this.updateStaticData();

            const toast = await this.toastCtrl.create({
                message: 'เปลี่ยนสถานะเป็น ยืนยันแล้ว สำเร็จ',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error updating status to confirmed:', error);
        }
    }

    async handlePay() {
        try {
            let newStatus: any = 'pending';
            let successMessage = 'ชำระเงินสำเร็จ กำลังตรวจสอบรายการ';

            if (this.internalStatus === 'checked_in_pending_payment') {
                newStatus = 'checked_in';
                successMessage = 'ชำระเงินสำเร็จ สถานะเปลี่ยนเป็นกำลังจอด';
            }

            await this.reservationService.updateReservationStatusv2(this.booking.id, newStatus);
            this.internalStatus = newStatus;
            this.booking.status = newStatus;
            this.updateStaticData();
            
            const toast = await this.toastCtrl.create({
                message: successMessage,
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error processing payment:', error);
        }
    }

    async handleApplyStamp() {
        try {
            
            const userId = this.reservationService.getCurrentProfileId();
            
            if (!userId) {
                this.showToast('ไม่พบข้อมูลผู้ใช้งาน กรุณาลองใหม่อีกครั้ง', 'danger');
                return;
            }

            const res = await this.reservationService.applyEStamp(this.booking.id, userId);
            if (res.success) {
                this.showToast(res.message || 'ลดราคาสำเร็จ!', 'success');
                
                await this.fetchCurrentFee();
            } else {
                this.showToast(res.error || 'ไม่สามารถลดราคาได้', 'danger');
            }
        } catch (e: any) {
            console.error('Error applying stamp:', e);
            this.showToast(e.message || 'เกิดข้อผิดพลาดในการลดราคา', 'danger');
        }
    }

    async showToast(message: string, color: string = 'success') {
        const toast = await this.toastCtrl.create({
            message,
            duration: 2000,
            color,
            position: 'bottom'
        });
        await toast.present();
    }

    async handleCheckInPendingPayment() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_in_pending_payment');
            this.internalStatus = 'checked_in_pending_payment';
            this.booking.status = 'checked_in_pending_payment';
            this.updateStaticData();
            this.fetchCurrentFee();

            const toast = await this.toastCtrl.create({
                message: 'เข้าจอดเรียบร้อย (รอชำระเงิน)',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error checking in (pending payment):', error);
        }
    }

    /**
     * สแกนป้ายทะเบียนด้วย AI for Thai แล้วเช็คอิน
     */
    async handleLprCheckIn() {
        this.isScanning = true;
        const loading = await this.loadingCtrl.create({
            message: 'กำลังเปิดกล้อง...',
            spinner: 'crescent'
        });
        await loading.present();

        try {
            // 1. ถ่ายรูป
            const imageFile = await this.lprService.captureFromCamera();
            if (!imageFile) {
                await loading.dismiss();
                this.isScanning = false;
                return;
            }

            loading.message = 'กำลังสแกนป้ายทะเบียน (AI for Thai)...';

            // 2. ส่งไปยัง AI for Thai LPR API
            const result = await this.lprService.recognizePlate(imageFile);
            this.lastScanResult = result;

            await loading.dismiss();

            if (!result.success) {
                await this.showLprAlert(
                    'สแกนไม่สำเร็จ',
                    result.error || 'ไม่พบป้ายทะเบียนในรูปภาพ',
                    'danger'
                );
                this.isScanning = false;
                return;
            }

            // 3. แสดงผลลัพธ์ป้ายทะเบียนและขอยืนยัน
            const plateDisplay = result.province
                ? `${result.licensePlate} ${result.province}`
                : result.licensePlate;

            const bookingPlate = this.booking.licensePlate.replace(/\s+/g, '');
            const scannedPlate = result.licensePlate.replace(/\s+/g, '');
            const isMatch = scannedPlate === bookingPlate || scannedPlate.includes(bookingPlate) || bookingPlate.includes(scannedPlate);

            const matchText = isMatch 
                ? `✅ ทะเบียนตรงกับข้อมูลการจอง`
                : `❌ ทะเบียนไม่ตรงกับข้อมูล\nคาดหวัง: ${this.booking.licensePlate}`;

            const alert = await this.alertCtrl.create({
                header: 'สแกนสำเร็จ',
                subHeader: 'ป้ายทะเบียนที่ตรวจพบ:',
                message: `${plateDisplay}\n\n${matchText}\n\nยืนยันเช็คอินด้วยป้ายทะเบียนนี้?`,
                buttons: [
                    {
                        text: 'ยกเลิก',
                        role: 'cancel'
                    },
                    {
                        text: 'ยืนยันเช็คอิน',
                        handler: async () => {
                            // 4. เปลี่ยนสถานะเป็น checked_in
                            try {
                                await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_in');
                                this.internalStatus = 'checked_in';
                                this.booking.status = 'checked_in';
                                this.updateStaticData();
                                this.fetchCurrentFee();

                                const toast = await this.toastCtrl.create({
                                    message: `เช็คอินสำเร็จ | ป้ายทะเบียน: ${plateDisplay}`,
                                    duration: 3000,
                                    color: 'success',
                                    position: 'bottom'
                                });
                                await toast.present();
                            } catch (error) {
                                console.error('Error LPR check-in:', error);
                                this.showToast('เกิดข้อผิดพลาดในการเช็คอิน', 'danger');
                            }
                        }
                    }
                ]
            });
            await alert.present();

        } catch (error) {
            await loading.dismiss();
            console.error('Error in LPR check-in:', error);
            this.showToast('เกิดข้อผิดพลาดในการสแกน', 'danger');
        }
        this.isScanning = false;
    }

    /**
     * สแกนป้ายทะเบียนด้วย AI for Thai แล้วเช็คเอาท์
     */
    async handleLprCheckOut() {
        this.isScanning = true;
        const loading = await this.loadingCtrl.create({
            message: 'กำลังเปิดกล้อง...',
            spinner: 'crescent'
        });
        await loading.present();

        try {
            // 1. ถ่ายรูป
            const imageFile = await this.lprService.captureFromCamera();
            if (!imageFile) {
                await loading.dismiss();
                this.isScanning = false;
                return;
            }

            loading.message = 'กำลังสแกนป้ายทะเบียน (AI for Thai)...';

            // 2. ส่งไปยัง AI for Thai LPR API
            const result = await this.lprService.recognizePlate(imageFile);
            this.lastScanResult = result;

            await loading.dismiss();

            if (!result.success) {
                await this.showLprAlert(
                    'สแกนไม่สำเร็จ',
                    result.error || 'ไม่พบป้ายทะเบียนในรูปภาพ',
                    'danger'
                );
                this.isScanning = false;
                return;
            }

            // 3. แสดงผลลัพธ์และขอยืนยัน
            const plateDisplay = result.province
                ? `${result.licensePlate} ${result.province}`
                : result.licensePlate;

            const bookingPlate = this.booking.licensePlate.replace(/\s+/g, '');
            const scannedPlate = result.licensePlate.replace(/\s+/g, '');
            const isMatch = scannedPlate === bookingPlate || scannedPlate.includes(bookingPlate) || bookingPlate.includes(scannedPlate);

            const matchText = isMatch 
                ? `✅ ทะเบียนตรงกับข้อมูลการจอง`
                : `❌ ทะเบียนไม่ตรงกับข้อมูล\nคาดหวัง: ${this.booking.licensePlate}`;

            const alert = await this.alertCtrl.create({
                header: 'สแกนสำเร็จ',
                subHeader: 'ป้ายทะเบียนที่ตรวจพบ:',
                message: `${plateDisplay}\n\n${matchText}\n\nค่าบริการ: ฿${this.booking.price || 0}\n\nยืนยันเช็คเอาท์ด้วยป้ายทะเบียนนี้?`,
                buttons: [
                    {
                        text: 'ยกเลิก',
                        role: 'cancel'
                    },
                    {
                        text: 'ยืนยันเช็คเอาท์',
                        cssClass: 'alert-button-danger',
                        handler: async () => {
                            // 4. เปลี่ยนสถานะเป็น confirmed (checkout)
                            try {
                                await this.reservationService.updateReservationStatusv2(this.booking.id, 'confirmed');
                                this.internalStatus = 'confirmed';
                                this.booking.status = 'confirmed';
                                this.updateStaticData();

                                const toast = await this.toastCtrl.create({
                                    message: `เช็คเอาท์สำเร็จ | ป้ายทะเบียน: ${plateDisplay}`,
                                    duration: 3000,
                                    color: 'success',
                                    position: 'bottom'
                                });
                                await toast.present();
                            } catch (error) {
                                console.error('Error LPR check-out:', error);
                                this.showToast('เกิดข้อผิดพลาดในการเช็คเอาท์', 'danger');
                            }
                        }
                    }
                ]
            });
            await alert.present();

        } catch (error) {
            await loading.dismiss();
            console.error('Error in LPR check-out:', error);
            this.showToast('เกิดข้อผิดพลาดในการสแกน', 'danger');
        }
        this.isScanning = false;
    }

    private async showLprAlert(header: string, message: string, color: string = 'danger') {
        const alert = await this.alertCtrl.create({
            header,
            message,
            buttons: ['ตกลง'],
            cssClass: color === 'danger' ? 'error-alert' : ''
        });
        await alert.present();
    }
}

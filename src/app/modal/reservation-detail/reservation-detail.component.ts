import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ModalController, ToastController, LoadingController, AlertController } from '@ionic/angular';
import { Booking } from '../../data/models';
import { ReservationService } from '../../services/reservation.service';
import { SupabaseService } from '../../services/supabase.service';
import { LprService, LprResult } from '../../services/lpr.service';
import { LprScannerComponent } from '../lpr-scanner/lpr-scanner.component';
import { RealtimeChannel } from '@supabase/supabase-js';

/**
 * ─── STATUS FLOW ────────────────────────────────────────────────────────────
 *
 * FLOW 1: จ่ายก่อน → Check-in ภายหลัง
 *   pending_payment ──[จ่าย Gateway]──► confirmed   (จ่ายแล้ว รอเข้าจอด)
 *   confirmed       ──[Check-in]──────► active       (กำลังจอด, จ่ายแล้ว ไม่มี E-Stamp)
 *   active          ──[Check-out]──────► checked_out (เสร็จสิ้น)
 *
 * FLOW 2: เข้าจอดก่อน → จ่ายทีหลัง
 *   pending_payment           ──[เช็คอินก่อน]──► checked_in_pending_payment
 *   checked_in_pending_payment──[E-Stamp]───────► (ลดราคา, สถานะไม่เปลี่ยน)
 *   checked_in_pending_payment──[จ่าย Gateway]──► active  (Webhook: paid while parked)
 *   active                    ──[Check-out]──────► checked_out
 *
 * ─── BUTTONS PER STATUS ─────────────────────────────────────────────────────
 * pending_payment            → ชำระเงิน | เช็คอินก่อนจ่ายทีหลัง | ยกเลิก
 * confirmed                  → เช็คอิน (Mock) | เช็คอิน (LPR)   (no cancel, no E-Stamp)
 * checked_in_pending_payment → E-Stamp | ชำระเงิน (บังคับก่อน check-out) | ปิด
 * active / checked_in        → เช็คเอาท์ (Mock) | เช็คเอาท์ (LPR)  (no E-Stamp)
 * checked_out / completed    → ปิดหน้าต่าง  (label: เสร็จสิ้น)
 * pending                    → เช็คอิน (Mock) | เช็คอิน (LPR) | ยกเลิก
 * cancelled                  → ปิดหน้าต่าง
 */
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

    // Payment QR state
    isPaymentLoading: boolean = false;
    paymentQrUrl: string | null = null;

    private paymentChannel: RealtimeChannel | null = null;
    private eStampChannel: RealtimeChannel | null = null;

    constructor(
        private modalCtrl: ModalController,
        private reservationService: ReservationService,
        private supabaseService: SupabaseService,
        private toastCtrl: ToastController,
        private loadingCtrl: LoadingController,
        private alertCtrl: AlertController,
        private lprService: LprService,
        private ngZone: NgZone
    ) { }

    ngOnInit() {
        this.internalStatus = this.booking.status;
        this.updateStaticData();
        this.fetchCurrentFee();
        this.setupEStampRealtime();
    }

    ngOnDestroy() {
        if (this.eStampChannel) this.supabaseService.client.removeChannel(this.eStampChannel);
        if (this.paymentChannel) this.supabaseService.client.removeChannel(this.paymentChannel);
    }

    // ── Realtime: E-Stamp fee updates ──────────────────────────────────────────
    setupEStampRealtime() {
        this.eStampChannel = this.supabaseService.client
            .channel(`e-stamp-${this.booking.id}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'e_stamps',
                filter: `reservation_id=eq.${this.booking.id}`
            }, () => this.fetchCurrentFee())
            .subscribe();
    }

    // ── Fetch live fee ─────────────────────────────────────────────────────────
    async fetchCurrentFee() {
        const liveStatuses = ['active', 'checked_in', 'checked_in_pending_payment'];
        if (liveStatuses.includes(this.internalStatus)) {
            try {
                const fee = await this.reservationService.getParkingFee(this.booking.id);
                this.ngZone.run(() => {
                    if (fee >= 0) this.booking.price = fee;
                });
            } catch (e) { console.error('fee error', e); }
            return;

        }
        // For pending_payment: try to read pre-computed amount from payments table
        if (this.internalStatus === 'pending_payment' && (!this.booking.price || this.booking.price === 0)) {
            try {
                const { data } = await this.supabaseService.client
                    .from('payments').select('amount')
                    .eq('reservation_id', this.booking.id)
                    .order('created_at', { ascending: false }).limit(1).maybeSingle();

                if (data?.amount) this.booking.price = data.amount;
            } catch (e) { /* ignore */ }
        }
    }

    // ── Status labels & colors ─────────────────────────────────────────────────
    updateStaticData() {
        const labels: Record<string, string> = {
            pending_payment:            'รอชำระเงิน',
            confirmed:                  'ชำระเงินแล้ว (รอเข้าจอด)',
            checked_in_pending_payment: 'กำลังจอด (ยังไม่ชำระ)',
            active:                     'กำลังจอด',
            checked_in:                 'กำลังจอด',
            pending:                    'รอตรวจสอบ',
            checked_out:                'เสร็จสิ้น',
            completed:                  'เสร็จสิ้น',
            cancelled:                  'ยกเลิกแล้ว',
        };
        this.statusLabel = labels[this.internalStatus] || this.booking.statusLabel || this.internalStatus;
    }

    getDotColor(): string {
        const map: Record<string, string> = {
            pending_payment: 'bg-orange-400',
            confirmed: 'bg-blue-500',
            checked_in_pending_payment: 'bg-orange-600',
            active: 'bg-green-500', checked_in: 'bg-green-500',
            pending: 'bg-amber-500',
            checked_out: 'bg-gray-400', completed: 'bg-gray-400',
            cancelled: 'bg-red-500',
        };
        return map[this.internalStatus] || 'bg-gray-400';
    }

    getTextColor(): string {
        const map: Record<string, string> = {
            pending_payment: 'text-orange-500',
            confirmed: 'text-blue-600',
            checked_in_pending_payment: 'text-orange-600',
            active: 'text-green-600', checked_in: 'text-green-600',
            pending: 'text-amber-500',
            checked_out: 'text-gray-500', completed: 'text-gray-500',
            cancelled: 'text-red-500',
        };
        return map[this.internalStatus] || 'text-gray-500';
    }

    getVehicleTypeLabel(type: string | undefined): string {
        const m: Record<string, string> = {
            car: 'รถยนต์', motorcycle: 'รถจักรยานยนต์',
            ev: 'รถยนต์ไฟฟ้า (EV)', other: 'อื่นๆ'
        };
        return m[type || ''] || type || 'รถยนต์';
    }

    // ── Dismiss / Cancel ───────────────────────────────────────────────────────
    dismiss() { this.modalCtrl.dismiss(); }
    handleCancel() { this.modalCtrl.dismiss({ action: 'cancel' }, 'confirm'); }

    openMap() {
        if (this.booking.lat && this.booking.lng)
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${this.booking.lat},${this.booking.lng}`, '_blank');
    }

    // ── PAYMENT via Gateway ────────────────────────────────────────────────────
    async handlePay() {
        this.isPaymentLoading = true;
        this.paymentQrUrl = null;
        try {
            await this.fetchCurrentFee();
            const amount = Number(this.booking.price) || 20;
            const amountToCharge = amount >= 20 ? amount : 20;

            const { data, error } = await this.supabaseService.client.functions.invoke('create-promptpay', {
                body: { reservation_id: this.booking.id, amount: amountToCharge }
            });
            if (error) throw error;

            if (data?.source?.scannable_code?.image?.download_uri) {
                this.paymentQrUrl = data.source.scannable_code.image.download_uri;
                this.subscribeToPaymentConfirmation();
            } else {
                throw new Error('ไม่สามารถสร้าง QR Code ได้');
            }
        } catch (e: any) {
            this.showToast('เกิดข้อผิดพลาด: ' + (e.message || 'ชำระเงินไม่ได้'), 'danger');
        } finally {
            this.isPaymentLoading = false;
        }
    }

    subscribeToPaymentConfirmation() {
        if (this.paymentChannel) this.supabaseService.client.removeChannel(this.paymentChannel);

        this.paymentChannel = this.supabaseService.client
            .channel(`pay-confirm-${this.booking.id}`)
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'reservations',
                filter: `id=eq.${this.booking.id}`
            }, (payload: any) => {
                const newStatus: string = payload.new.status;
                // Webhook will set: pending_payment→confirmed, checked_in_pending_payment→active
                if (newStatus === 'confirmed' || newStatus === 'active') {
                    this.ngZone.run(() => {
                        if (this.paymentChannel) this.supabaseService.client.removeChannel(this.paymentChannel);
                        this.paymentQrUrl = null;
                        this.internalStatus = newStatus;
                        this.booking.status = newStatus as any;
                        this.updateStaticData();
                        const msg = newStatus === 'active'
                            ? 'ชำระเงินสำเร็จ! ตอนนี้สามารถ Check-out ได้แล้ว ✅'
                            : 'ชำระเงินสำเร็จ! กรุณาเข้าจอดรถได้เลย ✅';
                        this.showToast(msg, 'success');
                    });
                }
            })
            .subscribe();
    }

    // ── E-STAMP ────────────────────────────────────────────────────────────────
    async handleApplyStamp() {
        const userId = this.reservationService.getCurrentProfileId();
        if (!userId) { this.showToast('ไม่พบข้อมูลผู้ใช้', 'danger'); return; }
        try {
            const res = await this.reservationService.applyEStamp(this.booking.id, userId);
            if (res.success) {
                this.showToast(res.message || 'ลดราคาสำเร็จ!', 'success');
                await this.fetchCurrentFee();
            } else {
                this.showToast(res.error || 'ไม่สามารถลดราคาได้', 'danger');
            }
        } catch (e: any) {
            this.showToast(e.message || 'เกิดข้อผิดพลาด', 'danger');
        }
    }

    // ── CHECK-IN ───────────────────────────────────────────────────────────────
    /** Mock: confirmed → active (จ่ายแล้ว เข้าจอด) */
    async handleSimulateCheckIn() {
        const targetStatus = this.internalStatus === 'confirmed' ? 'active' : 'checked_in';
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, targetStatus);
            this.internalStatus = targetStatus;
            this.booking.status = targetStatus as any;
            this.updateStaticData();
            this.fetchCurrentFee();
            this.showToast('เช็คอินสำเร็จ (Mock) ✅', 'success');
        } catch (e: any) { this.showToast('เช็คอินล้มเหลว: ' + e.message, 'danger'); }
    }

    /** pending_payment → checked_in_pending_payment */
    async handleCheckInPendingPayment() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_in_pending_payment');
            this.internalStatus = 'checked_in_pending_payment';
            this.booking.status = 'checked_in_pending_payment';
            this.updateStaticData();
            this.fetchCurrentFee();
            this.showToast('เข้าจอดแล้ว (รอชำระเงิน)', 'success');
        } catch (e: any) { this.showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger'); }
    }

    // ── CHECK-OUT ──────────────────────────────────────────────────────────────
    /** active → checked_out */
    async handleCheckoutConfirm() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_out');
            this.internalStatus = 'checked_out';
            this.booking.status = 'checked_out' as any;
            this.updateStaticData();
            this.showToast('Check-out สำเร็จ! ขอบคุณที่ใช้บริการ 🙏', 'success');
        } catch (e: any) { this.showToast('Check-out ล้มเหลว: ' + e.message, 'danger'); }
    }

    // ── LPR ────────────────────────────────────────────────────────────────────
    async handleLprCheckIn() { await this.openLprScanner('checkin'); }
    async handleLprCheckOut() { await this.openLprScanner('checkout'); }

    private async openLprScanner(mode: 'checkin' | 'checkout') {
        this.isScanning = true;
        const modal = await this.modalCtrl.create({
            component: LprScannerComponent,
            componentProps: { bookingPlate: this.booking.licensePlate, mode },
            initialBreakpoint: 1, breakpoints: [0, 0.5, 1],
            backdropDismiss: true, cssClass: 'detail-sheet-modal',
        });
        await modal.present();
        const { data } = await modal.onDidDismiss();
        this.isScanning = false;
        if (!data) return;

        const result: LprResult = data.result;
        const plate = result.province ? `${result.licensePlate} ${result.province}` : result.licensePlate;

        try {
            if (data.action === 'lpr_checkin') {
                // confirmed → active (paid, via LPR)
                const targetStatus = this.internalStatus === 'confirmed' ? 'active' : 'checked_in';
                await this.reservationService.updateReservationStatusv2(this.booking.id, targetStatus);
                this.internalStatus = targetStatus;
                this.booking.status = targetStatus as any;
                this.updateStaticData();
                this.fetchCurrentFee();
                this.showToast(`เช็คอิน (LPR) สำเร็จ | ${plate}`, 'success');
            } else if (data.action === 'lpr_checkout') {
                await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_out');
                this.internalStatus = 'checked_out';
                this.booking.status = 'checked_out' as any;
                this.updateStaticData();
                this.showToast(`Check-out (LPR) สำเร็จ | ${plate}`, 'success');
            }
        } catch (e: any) {
            this.showToast(`เกิดข้อผิดพลาด: ${e.message}`, 'danger');
        }
    }

    // ── Toast ──────────────────────────────────────────────────────────────────
    async showToast(message: string, color = 'success') {
        const t = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
        await t.present();
    }
}

import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Router } from '@angular/router';

@Component({
  selector: 'app-booking-success-modal',
  templateUrl: './booking-success-modal.component.html',
  styleUrls: ['./booking-success-modal.component.scss'],
  standalone: false
})
export class BookingSuccessModalComponent implements OnInit {
  @Input() bookingData: any;

  constructor(
    private modalCtrl: ModalController,
    private router: Router
  ) { }

  ngOnInit() {
    
    setTimeout(() => {
      const checkmark = document.querySelector('.success-checkmark');
      if (checkmark) {
        checkmark.classList.add('animate');
      }
    }, 100);
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }

  async goToBookings() {
    await this.modalCtrl.dismiss();
    await this.modalCtrl.dismiss();
    this.router.navigate(['/tabs/tab2']);
  }

  formatDateTime(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const thaiDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    
    const dayName = thaiDays[d.getDay()];
    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543;
    const hours = this.pad(d.getHours());
    const minutes = this.pad(d.getMinutes());
    
    return `${dayName} ${day} ${month} ${year} เวลา ${hours}:${minutes} น.`;
  }

  pad(num: number): string {
    return num < 10 ? '0' + num : num.toString();
  }

  getStatusIcon(): string {
    const status = this.bookingData?.status;
    if (status === 'confirmed') return 'checkmark-circle';
    if (status === 'pending' || status === 'pending_payment') return 'time-outline';
    return 'checkmark-circle';
  }

  getStatusText(): string {
    const status = this.bookingData?.status;
    if (status === 'confirmed') return 'ยืนยันแล้ว';
    if (status === 'pending') return 'รอดำเนินการ';
    if (status === 'pending_payment') return 'รอการชำระเงิน';
    return this.bookingData?.statusLabel || 'รอดำเนินการ';
  }
}

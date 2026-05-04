import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Parking3DModalComponent } from '../parking-3d-modal/parking-3d-modal.component';

@Component({
    selector: 'app-booking-type-selector',
    templateUrl: './booking-type-selector.component.html',
    styleUrls: ['./booking-type-selector.component.scss'],
    standalone: false
})
export class BookingTypeSelectorComponent implements OnInit {

    bookingTypes = [
        {
            id: 'daily',
            title: 'รายชั่วโมง (ทั่วไป)',
            desc: 'จองตามระยะเวลาจริง เริ่มต้น 20 บ./ชม.',
            icon: 'time-outline',
            color: 'primary',
            hexColor: '#3b82f6', 
            badge: null
        },
        {
            id: 'flat24',
            title: 'เหมาจ่าย 24 ชม.',
            desc: 'จอดได้ยาว 24 ชั่วโมง ราคาพิเศษ',
            icon: 'sync-circle-outline',
            color: 'success',
            hexColor: '#10b981', 
            badge: 'สุดคุ้ม'
        },
        {
            id: 'monthly',
            title: 'สมาชิกรายเดือน',
            desc: 'จอดได้ตลอด 24 ชม. ไม่จำกัดจำนวนครั้ง',
            icon: 'calendar-number-outline',
            color: 'tertiary',
            hexColor: '#8b5cf6', 
            badge: null
        },

    ];

    constructor(private modalCtrl: ModalController) { }

    ngOnInit() { }

    selectType(typeId: string) {
        this.modalCtrl.dismiss({ bookingMode: typeId }, 'confirm');
    }

    close() {
        this.modalCtrl.dismiss(null, 'cancel');
    }

    async open3DMap() {
        const modal = await this.modalCtrl.create({
            component: Parking3DModalComponent,
            cssClass: 'parking-3d-modal'
        });
        await modal.present();
    }

}

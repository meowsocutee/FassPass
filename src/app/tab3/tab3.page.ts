import { Component, OnInit } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { SettingItem, UserProfile, Vehicle } from '../data/models';
import { ParkingDataService } from '../services/parking-data.service';
import { GENERAL_SETTINGS, OTHER_SETTINGS } from '../data/app-settings';
import { AddVehicleModalComponent } from '../modal/add-vehicle/add-vehicle-modal.component';
import { EditProfileModalComponent } from '../modal/edit-profile-modal/edit-profile-modal.component';
import { InviteVisitorModalComponent } from '../modal/invite-visitor/invite-visitor-modal.component';
import { SwitchMenuModalComponent } from '../components/switch-menu-modal/switch-menu-modal.component';
import { DocumentModalComponent } from '../modal/document-modal/document-modal.component';
import { AuthService } from '../services/auth.service';
import { LineService } from '../services/line.service';

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  standalone: false,
})
export class Tab3Page implements OnInit {
  selectedSegment: 'dashboard' | 'list' = 'dashboard';

  userProfile: UserProfile = { name: '', phone: '', avatar: '', role: 'Visitor' };
  vehicles: Vehicle[] = [];
  generalSettings = GENERAL_SETTINGS;
  otherSettings = OTHER_SETTINGS;

  constructor(
    private parkingService: ParkingDataService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private authService: AuthService,
    private lineService: LineService
  ) { }

  ngOnInit() {
    this.parkingService.userProfile$.subscribe(p => { if (p) this.userProfile = p; });
    this.parkingService.vehicles$.subscribe(v => {

      this.vehicles = [...v].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return 0;
      });
    });
  }

  segmentChanged(event: any) {
    this.selectedSegment = event.detail.value;
  }

  async selectVehicle(vehicleId: number | string) {
    const selectedCar = this.vehicles.find(v => v.id === vehicleId);
    if (!selectedCar || selectedCar.isDefault) return;

    const alert = await this.alertCtrl.create({
      header: 'ตั้งเป็นยานพาหนะหลัก',
      message: `คุณต้องการตั้งรถทะเบียน <strong>${selectedCar.licensePlate}</strong> เป็นยานพาหนะหลักหรือไม่?`,
      buttons: [
        {
          text: 'ยกเลิก',
          role: 'cancel',
          cssClass: 'text-gray-500'
        },
        {
          text: 'ยืนยัน',
          role: 'confirm',
          handler: async () => {
            try {
              await this.parkingService.setDefaultVehicle(vehicleId);
              this.showToast('ตั้งค่าเป็นยานพาหนะหลักเรียบร้อย', 'success');
            } catch (e) {
              this.showToast('เกิดข้อผิดพลาด ไม่สามารถตั้งค่าได้', 'error');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async addVehicle() {
    if (this.vehicles.length >= 3) {
      await this.showToast('ไม่สามารถเพิ่มยานพาหนะได้ เนื่องจากถึงขีดจำกัด 3 คันแล้ว', 'error');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: AddVehicleModalComponent,
      breakpoints: [0, 0.85, 1],
      initialBreakpoint: 0.85,
      cssClass: 'add-vehicle-modal'
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss();

    if (role === 'confirm' && data) {
      if (this.vehicles.length >= 3) {
        await this.showToast('ไม่สามารถเพิ่มยานพาหนะได้ เนื่องจากถึงขีดจำกัด 3 คันแล้ว', 'error');
        return;
      }


      const newVehicle: Partial<Vehicle> = {
        ...data,

      };

      console.log('[Tab3Page] Submitting new vehicle:', newVehicle);

      try {
        await this.parkingService.addVehicle(newVehicle);
        console.log('[Tab3Page] Vehicle added workflow complete');

        await this.showToast('เพิ่มยานพาหนะสำเร็จเรียบร้อย', 'success');

      } catch (error: any) {
        console.error('[Tab3Page] Failed to add vehicle:', error);


        let msg = 'เกิดข้อผิดพลาด ไม่สามารถเพิ่มยานพาหนะได้';
        if (error.message) {
          msg = error.message;
        }

        await this.showToast(msg, 'error');
      }
    }
  }

  async editVehicle(vehicle: Vehicle) {
    const modal = await this.modalCtrl.create({
      component: AddVehicleModalComponent,
      breakpoints: [0, 0.85, 1],
      initialBreakpoint: 0.85,
      cssClass: 'add-vehicle-modal',
      componentProps: {
        editVehicle: vehicle
      }
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss();

    if (role === 'confirm' && data) {
      console.log('[Tab3Page] Submitting edited vehicle:', data);
      try {

        const editedVehicle = {
          ...vehicle,
          ...data
        } as Vehicle;



        await this.parkingService.updateVehicle(editedVehicle);
        console.log('[Tab3Page] Vehicle edit workflow complete');

        await this.showToast('แก้ไขข้อมูลยานพาหนะสำเร็จเรียบร้อย', 'success');

      } catch (error) {
        console.error('[Tab3Page] Failed to edit vehicle:', error);
        await this.showToast('เกิดข้อผิดพลาด ไม่สามารถแก้ไขยานพาหนะได้', 'error');
      }
    }
  }

  async openEditProfile() {
    const modal = await this.modalCtrl.create({
      component: EditProfileModalComponent,
      componentProps: {
        currentProfile: this.userProfile
      },
      breakpoints: [0, 0.55, 1],
      initialBreakpoint: 0.55,
      cssClass: 'edit-profile-modal'
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss();

    if (role === 'confirm' && data) {


      this.userProfile = { ...this.userProfile, ...data };
    }
  }

  async confirmDeleteVehicle(vehicle: Vehicle) {
    const alert = await this.alertCtrl.create({
      header: 'ยืนยันการลบ',
      message: `คุณต้องการลบรถทะเบียน <strong>${vehicle.licensePlate}</strong> ใช่หรือไม่?`,
      buttons: [
        {
          text: 'ยกเลิก',
          role: 'cancel',
          cssClass: 'text-gray-500'
        },
        {
          text: 'ลบ',
          role: 'confirm',
          cssClass: 'text-red-500 font-bold',
          handler: async () => {
            try {
              await this.parkingService.deleteVehicle(vehicle.id);
              this.showToast('ลบยานพาหนะสำเร็จ', 'success');
            } catch (e) {
              this.showToast('เกิดข้อผิดพลาด ไม่สามารถลบได้', 'error');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async showToast(message: string, type: 'success' | 'error' = 'success') {
    const icon = type === 'success' ? 'checkmark-circle' : 'alert-circle';
    const cssClass = type === 'success' ? 'custom-toast success-toast' : 'custom-toast error-toast';

    const toast = await this.toastCtrl.create({
      message: message,
      duration: 3000,
      position: 'top',
      cssClass: cssClass,
      icon: icon,
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
          handler: () => {
            console.log('Close clicked');
          }
        }
      ]
    });
    await toast.present();
  }

  getLicensePlateParts(plate: string): string[] {
    return plate ? plate.split(' ') : ['', ''];
  }

  async openSwitchMenu() {
    const modal = await this.modalCtrl.create({
      component: SwitchMenuModalComponent,
      componentProps: { currentProfile: this.userProfile },
      breakpoints: [0, 0.9],
      initialBreakpoint: 0.9,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data && this.userProfile.id) {

      this.parkingService.loadUserProfile(this.userProfile.id);
    }
  }

  async openInviteModal() {
    const modal = await this.modalCtrl.create({
      component: InviteVisitorModalComponent,
      breakpoints: [0, 0.75, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {
      console.log('Invite created:', data);
    }
  }

  async openSetting(item: SettingItem) {
    if (item.title === 'เวอร์ชันแอปพลิเคชัน') {
      this.showToast(`เวอร์ชันปัจจุบัน: ${item.value || '1.0.0'}`, 'success');
      return;
    }

    let contentHtml = '';

    if (item.title === 'เงื่อนไขการใช้งาน') {
      contentHtml = `
        <h2>ข้อตกลงและเงื่อนไขการใช้บริการ</h2>
        <p>ยินดีต้อนรับสู่แอปพลิเคชัน FASTPAST การใช้งานแอปพลิเคชันนี้อยู่ภายใต้เงื่อนไขดังต่อไปนี้:</p>
        <ul>
          <li>ผู้ใช้ต้องให้ข้อมูลที่เป็นความจริงในการลงทะเบียน</li>
          <li>การจองที่จอดรถต้องเป็นไปตามกฎระเบียบของสถานที่นั้นๆ</li>
          <li>บริษัทไม่รับผิดชอบต่อความเสียหายใดๆ ที่เกิดขึ้นกับยานพาหนะ</li>
          <li>ผู้ใช้ต้องปฏิบัติตามกฎหมายจราจรอย่างเคร่งครัด</li>
        </ul>
        <p><strong>การยอมรับเงื่อนไข:</strong> การใช้งานแอปพลิเคชันนี้ถือว่าคุณยอมรับเงื่อนไขทั้งหมด</p>
      `;
    } else if (item.title === 'นโยบายความเป็นส่วนตัว') {
      contentHtml = `
        <h2>นโยบายความเป็นส่วนตัว</h2>
        <p>แอปพลิเคชันให้ความสำคัญกับข้อมูลส่วนบุคคลของคุณ:</p>
        <ul>
          <li><strong>การเก็บข้อมูล:</strong> เราจัดเก็บเฉพาะข้อมูลที่จำเป็น เช่น ทะเบียนรถ เบอร์โทรศัพท์</li>
          <li><strong>การใช้งานข้อมูล:</strong> เพื่ออำนวยความสะดวกในการเข้าออกและจองที่จอดรถ</li>
          <li><strong>การเปิดเผยข้อมูล:</strong> ข้อมูลของคุณจะไม่ถูกเปิดเผยแก่บุคคลที่สามโดยไม่ได้รับอนุญาต</li>
          <li><strong>ความปลอดภัย:</strong> เรามีมาตรการรักษาความปลอดภัยของข้อมูลขั้นสูงสุด</li>
        </ul>
        <p>หากมีข้อสงสัยโปรดติดต่อฝ่ายสนับสนุนลูกค้า</p>
      `;
    } else if (item.title === 'เกี่ยวกับเรา') {
      contentHtml = `
        <h2>เกี่ยวกับ FASTPAST</h2>
        <p>FASTPAST เป็นแพลตฟอร์มที่ช่วยให้การจองและเข้าจอดรถเป็นเรื่องง่ายและรวดเร็ว</p>
        <p>พัฒนาโดยทีมวิศวกรผู้เชี่ยวชาญด้านระบบลานจอดรถอัจฉริยะ พร้อมด้วยเทคโนโลยี AI ในการอ่านป้ายทะเบียนที่แม่นยำ</p>
        <p><strong>ติดต่อเรา:</strong> support@fastpast.com</p>
      `;
    }

    if (contentHtml) {
      const modal = await this.modalCtrl.create({
        component: DocumentModalComponent,
        componentProps: {
          title: item.title,
          contentHtml: contentHtml
        },
        breakpoints: [0, 0.5, 0.85, 1],
        initialBreakpoint: 0.85,
      });
      await modal.present();
    }
  }

  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'ยืนยันการออกจากระบบ',
      message: 'คุณต้องการออกจากระบบและสลับไปใช้บัญชีอื่นใช่หรือไม่?',
      buttons: [
        {
          text: 'ยกเลิก',
          role: 'cancel',
          cssClass: 'text-gray-500'
        },
        {
          text: 'ออกจากระบบ',
          role: 'confirm',
          cssClass: 'text-red-500 font-bold',
          handler: async () => {
            try {
              if (this.userProfile?.id) {
                await this.lineService.unlinkRichMenu(this.userProfile.id);
              }
              await this.authService.signOut();
              this.lineService.logout();
              window.location.reload();
            } catch (err) {
              console.error('Logout error:', err);
              this.showToast('เกิดข้อผิดพลาดในการออกจากระบบ', 'error');
            }
          }
        }
      ]
    });
    await alert.present();
  }
}




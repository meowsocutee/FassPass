import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { Parking3DComponent } from '../../components/parking-3d/parking-3d.component';

@Component({
  selector: 'app-parking-3d-modal',
  standalone: true,
  imports: [IonicModule, Parking3DComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>แผนผังลานจอดรถ 3D</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="closeModal()">ปิด</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <app-parking-3d></app-parking-3d>
    </ion-content>
  `,
  styles: [`
    ion-content {
      --background: #EBF0F5;
    }
  `]
})
export class Parking3DModalComponent {
  constructor(private modalCtrl: ModalController) {}

  closeModal() {
    this.modalCtrl.dismiss();
  }
}

import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Tab2Page } from './tab2.page';
import { ExploreContainerComponentModule } from '../explore-container/explore-container.module';

import { Tab2PageRoutingModule } from './tab2-routing.module';

import { ReservationDetailComponent } from '../modal/reservation-detail/reservation-detail.component';
import { LprScannerComponent } from '../modal/lpr-scanner/lpr-scanner.component';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ExploreContainerComponentModule,
    Tab2PageRoutingModule,
    LprScannerComponent
  ],
  declarations: [Tab2Page, ReservationDetailComponent]
})
export class Tab2PageModule { }

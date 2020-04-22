import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';

import * as copy from 'copy-to-clipboard';
import { DialogService } from '../select-popup/dialog';
import { DeliveryStatus } from '../families/DeliveryStatus';
import { Context } from '@remult/core';

import { translate } from '../translate';
import { UpdateCommentComponent } from '../update-comment/update-comment.component';
import { UpdateFamilyDialogComponent } from '../update-family-dialog/update-family-dialog.component';
import { extractError } from '../model-shared/types';
import { ActiveFamilyDeliveries } from '../family-deliveries/family-deliveries-join';
@Component({
  selector: 'app-family-info',
  templateUrl: './family-info.component.html',
  styleUrls: ['./family-info.component.scss']
})
export class FamilyInfoComponent implements OnInit {

  constructor(private dialog: DialogService, private context: Context) { }
  @Input() f: ActiveFamilyDeliveries;
  @Input() showHelp = false;
  ngOnInit() {
  }
  actuallyShowHelp() {
    return this.showHelp && this.f.deliverStatus.value != DeliveryStatus.ReadyForDelivery;
  }
  @Input() partOfAssign: Boolean;
  @Output() assignmentCanceled = new EventEmitter<void>();
  
  showCancelAssign(f: ActiveFamilyDeliveries) {
    return this.partOfAssign && f.courier.value != '' && f.deliverStatus.value == DeliveryStatus.ReadyForDelivery;
  }
  showFamilyPickedUp(f: ActiveFamilyDeliveries) {
    return f.deliverStatus.value == DeliveryStatus.SelfPickup;
  }
  async familiyPickedUp(f: ActiveFamilyDeliveries) {
    this.context.openDialog(UpdateCommentComponent, x => x.args =
    {
      family: f,
      comment: f.courierComments.value,
      helpText: s => s.commentForSuccessDelivery,
      ok: async (comment) => {
        f.deliverStatus.value = DeliveryStatus.SuccessPickedUp;
        f.courierComments.value = comment;
        f.checkNeedsWork();
        try {
          await f.save();
          this.dialog.analytics('Self Pickup');
        }
        catch (err) {
          this.dialog.Error(extractError( err));
        }
      },
      cancel: () => { }
    });

  }
  async cancelAssign(f: Families) {

    this.assignmentCanceled.emit();

  }
  openWaze(f: Families) {
    if (!f.addressOk.value) {
      this.dialog.YesNoQuestion(translate("הכתובת אינה מדוייקת. בדקו בגוגל או התקשרו למשפחה. נשמח אם תעדכנו את הכתובת שמצאתם בהערות. האם לפתוח וייז?"), () => {
        f.openWaze();
      });
    }
    else
      f.openWaze();


  }
  udpateInfo(f: Families) {
    this.context.openDialog(UpdateFamilyDialogComponent, x => x.args = { f: f });
  }
  copyAddress(f: Families) {
    copy(f.address.value);
    this.dialog.Info("הכתובת " + f.address.value + " הועתקה בהצלחה");
  }
  showStatus() {
    return this.f.deliverStatus.value != DeliveryStatus.ReadyForDelivery && this.f.deliverStatus.value != DeliveryStatus.SelfPickup;
  }
}

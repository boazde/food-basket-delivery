import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Families } from '../families/families';
import { BusyService, AndFilter } from '@remult/core';
import { MatDialogRef } from '@angular/material/dialog';
import { FilterBase } from '@remult/core';
import { Context } from '@remult/core';
import { DeliveryStatus } from '../families/DeliveryStatus';


@Component({
  selector: 'app-select-family',
  templateUrl: './select-family.component.html',
  styleUrls: ['./select-family.component.scss']
})
export class SelectFamilyComponent implements OnInit {

  public args: {
    where: (f: Families) => FilterBase,
    onSelect: (selectedValue: Families) => void,
    selectStreet: boolean,
    distCenter: string
  };
  @ViewChild("search", { static: true }) search: ElementRef;
  constructor(private busy: BusyService, private dialogRef: MatDialogRef<any>, private context: Context) { }
  searchString: string = '';
  families = this.context.for(Families).gridSettings({ knowTotalRows: true });
  pageSize = 7;
  selectFirst() {
    if (this.families.items.length > 0)
      this.select(this.families.items[0]);
  }

  async doFilter() {
    await this.busy.donotWait(async () => this.getRows());
  }
  async getRows() {

    await this.families.get({
      where: f => {
        let result = f.filterDistCenter(this.args.distCenter);
        {
          let r = f.name.isContains(this.searchString);
          if (this.args.selectStreet)
            r = f.address.isContains(this.searchString);
          result = new AndFilter(result, r);
        }
        if (this.args.where) {
          let x = this.args.where(f);
          if (x)
            return new AndFilter(result, x);
        }
        return result;
      },
      orderBy: f => f.name,
      limit: this.pageSize
    });


  }
  clearHelper() {
    this.dialogRef.close();
  }
  select(f: Families) {
    this.args.onSelect(f);
    this.dialogRef.close();
  }
  async selectAllInStreet() {
    this.pageSize = 1000;
    await this.getRows();
    for (const f of this.families.items) {
      this.args.onSelect(f);
    }
    this.dialogRef.close();

  }
  showStatus(f: Families) {
    if (f.deliverStatus.value == DeliveryStatus.ReadyForDelivery) {
      if (f.courier.value) {
        return 'משוייך למשנע';
      } else {
        return '';
      }
    }
    return f.deliverStatus.displayValue;
  }
  async ngOnInit() {
    this.busy.donotWait(async () =>
      await this.getRows());
    this.search.nativeElement.focus();
  }
  moreFamilies() {
    this.pageSize += 7;
    this.getRows();
  }


}

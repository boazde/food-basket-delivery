import { DeliveryStatus, DeliveryStatusColumn } from "./DeliveryStatus";
import { CallStatusColumn } from "./CallStatus";
import { YesNoColumn } from "./YesNo";

import { FamilySourceId } from "./FamilySources";
import { BasketId, BasketType } from "./BasketType";
import { changeDate, DateTimeColumn, SqlBuilder, PhoneColumn, delayWhileTyping } from "../model-shared/types";
import { DataControlSettings, Column, Context, EntityClass, ServerFunction, IdEntity, IdColumn, StringColumn, NumberColumn, BoolColumn, SqlDatabase, DateColumn, FilterBase } from '@remult/core';
import { HelperIdReadonly, HelperId, Helpers, HelperUserInfo } from "../helpers/helpers";

import { GeocodeInformation, GetGeoInformation } from "../shared/googleApiHelpers";
import { ApplicationSettings } from "../manage/ApplicationSettings";
import { FamilyDeliveries } from "./FamilyDeliveries";
import * as fetch from 'node-fetch';
import { Roles } from "../auth/roles";

import { translate } from "../translate";
import { UpdateGroupDialogComponent } from "../update-group-dialog/update-group-dialog.component";
import { DistributionCenterId, DistributionCenters } from "../manage/distribution-centers";
import { PromiseThrottle } from "../import-from-excel/import-from-excel.component";


@EntityClass
export class Families extends IdEntity {
  static allCentersToken = '<allCenters>';
  filterDistCenter(distCenter: string): import("@remult/core").FilterBase {
    return this.distributionCenter.filter(distCenter);
  }
  onTheWayFilter() {
    return this.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery).and(this.courier.isDifferentFrom(''));
  }
  setNewBasket() {
    if (this.defaultSelfPickup.value) {
      this.deliverStatus.value = DeliveryStatus.SelfPickup;
      this.courier.value = '';
    }
    else {
      this.deliverStatus.value = DeliveryStatus.ReadyForDelivery;
      if (this.courier.value == this.courier.originalValue) {
        this.courier.value = this.fixedCourier.value;
        this.courierAssignUser.value = this.context.user.id;
        this.courierAssingTime.value = new Date();
      }
    }
  }
  getDeliveries() {
    return this.context.for(FamilyDeliveries).find({ where: d => d.family.isEqualTo(this.id), orderBy: d => [{ column: d.deliveryStatusDate, descending: true }] });
  }
  checkNeedsWork() {
    if (this.courierComments.value)
      this.needsWork.value = true;
    switch (this.deliverStatus.value) {
      case DeliveryStatus.FailedBadAddress:
      case DeliveryStatus.FailedNotHome:
      case DeliveryStatus.FailedOther:
        this.needsWork.value = true;
        break;
    }
  }
  __disableGeocoding = false;
  _disableMessageToUsers = false;
  constructor(private context: Context) {
    super(
      {
        name: "Families",
        allowApiRead: context.isSignedIn(),
        allowApiUpdate: context.isSignedIn(),
        allowApiDelete: false,
        allowApiInsert: Roles.admin,
        apiDataFilter: () => {
          if (!context.isAllowed(Roles.admin)) {
            let user = <HelperUserInfo>context.user;
            if (!user)
              return this.id.isEqualTo('no rows');
            if (context.isAllowed(Roles.distCenterAdmin))
              return this.distributionCenter.isAllowedForUser();
            if (user.theHelperIAmEscortingId)
              return this.courier.isEqualTo(user.theHelperIAmEscortingId).and(this.visibleToCourier.isEqualTo(true));
            else
              return this.courier.isEqualTo(user.id).and(this.visibleToCourier.isEqualTo(true));
          }
        },
        savingRow: async () => {
          if (this.disableOnSavingRow)
            return;
          if (this.context.onServer) {
            if (!this.correntAnErrorInStatus.value && DeliveryStatus.IsAResultStatus(this.deliverStatus.originalValue) && !DeliveryStatus.IsAResultStatus(this.deliverStatus.value)) {
              var fd = this.context.for(FamilyDeliveries).create();
              fd.family.value = this.id.value;
              fd.familyName.value = this.name.value;
              fd.basketType.value = this.basketType.originalValue;
              fd.deliverStatus.value = this.deliverStatus.originalValue;
              fd.courier.value = this.courier.originalValue;
              fd.distributionCenter.value = this.distributionCenter.value;
              fd.courierComments.value = this.courierComments.originalValue;
              fd.deliveryStatusDate.value = this.deliveryStatusDate.originalValue;
              fd.courierAssignUser.value = this.courierAssignUser.originalValue;
              fd.courierAssingTime.value = this.courierAssingTime.originalValue;
              fd.archiveFamilySource.value = this.familySource.originalValue;
              fd.archiveGroups.value = this.groups.value;
              fd.archive_address.value = this.address.originalValue;

              fd.archive_floor.value = this.floor.originalValue;
              fd.archive_appartment.value = this.appartment.originalValue;
              fd.archive_entrance.value = this.entrance.originalValue;
              fd.archive_postalCode.value = this.postalCode.originalValue;
              fd.archive_city.value = this.city.originalValue;
              fd.archive_addressComment.value = this.addressComment.originalValue;
              fd.archive_deliveryComments.value = this.deliveryComments.originalValue;
              fd.archive_phone1.value = this.phone1.originalValue;
              fd.archive_phone1Description.value = this.phone1Description.originalValue;
              fd.archive_phone2.value = this.phone2.originalValue;
              fd.archive_phone2Description.value = this.phone2Description.originalValue;
              fd.archive_phone3.value = this.phone3.originalValue;
              fd.archive_phone3Description.value = this.phone3Description.originalValue;
              fd.archive_phone4.value = this.phone4.originalValue;
              fd.archive_phone4Description.value = this.phone4Description.originalValue;
              fd.archive_addressLongitude.value = this.addressLongitude.originalValue;
              fd.archive_addressLatitude.value = this.addressLatitude.originalValue;
              await fd.save();
              if (this.courier.value == this.courier.originalValue) {
                this.courier.value = this.fixedCourier.value;
                this.courierAssignUser.value = this.context.user.id;
                this.courierAssingTime.value = new Date();
              }
              if (this.courierComments.value == this.courierComments.originalValue)
                this.courierComments.value = '';
              this.needsWork.value = false;
            }


            if (this.fixedCourier.value && !this.fixedCourier.originalValue && !this.courier.value && this.deliverStatus.value == DeliveryStatus.ReadyForDelivery) {
              this.courier.value = this.fixedCourier.value;
            }

            if (this.address.value != this.address.originalValue || !this.getGeocodeInformation().ok()) {
              await this.reloadGeoCoding();
            }
            if (this.isNew()) {
              this.createDate.value = new Date();
              this.createUser.value = context.user.id;
            }
            this.lastUpdateDate.value = new Date();
            let logChanged = (col: Column<any>, dateCol: DateTimeColumn, user: HelperId, wasChanged: (() => void)) => {
              if (col.value != col.originalValue) {
                dateCol.value = new Date();
                user.value = context.user.id;
                wasChanged();
              }
            }
            if (!this.disableChangeLogging) {
              logChanged(this.courier, this.courierAssingTime, this.courierAssignUser, async () => {
                if (!this._disableMessageToUsers)
                  Families.SendMessageToBrowsers(Families.GetUpdateMessage(this, 2, await this.courier.getTheName()), this.context, this.distributionCenter.value)
              }
              );//should be after succesfull save
              //logChanged(this.callStatus, this.callTime, this.callHelper, () => { });
              logChanged(this.deliverStatus, this.deliveryStatusDate, this.deliveryStatusUser, async () => {
                if (!this._disableMessageToUsers)
                  Families.SendMessageToBrowsers(Families.GetUpdateMessage(this, 1, await this.courier.getTheName()), this.context, this.distributionCenter.value);
              }); //should be after succesfull save
              logChanged(this.needsWork, this.needsWorkDate, this.needsWorkUser, async () => { }); //should be after succesfull save
            }
          }
        }

      });

    if (!context.isAllowed([Roles.admin, Roles.distCenterAdmin])) {
      for (const key in this) {
        if (this.hasOwnProperty(key)) {
          const c = this[key];
          if (c instanceof Column) {
            //@ts-ignore
            c.defs.allowApiUpdate = c == this.courierComments || c == this.deliverStatus || c == this.correntAnErrorInStatus || c == this.needsWork;
          }

        }
      }

    }
  }
  disableChangeLogging = false;
  disableOnSavingRow = false;


  name = new StringColumn({
    caption: "שם",
    valueChange: () => this.delayCheckDuplicateFamilies(),
    validate: () => {
      if (!this.name.value || this.name.value.length < 2)
        this.name.validationError = 'השם קצר מידי';
    }
  });

  tz = new StringColumn({
    caption: 'מספר זהות', includeInApi: Roles.admin, valueChange: () => this.delayCheckDuplicateFamilies()
  });
  tz2 = new StringColumn({
    caption: 'מספר זהות בן/בת הזוג', includeInApi: Roles.admin, valueChange: () => this.delayCheckDuplicateFamilies()
  });
  familyMembers = new NumberColumn({ includeInApi: Roles.admin, caption: 'מספר נפשות' });
  birthDate = new DateColumn({ includeInApi: Roles.admin, caption: 'תאריך לידה' });
  nextBirthday = new DateColumn({
    includeInApi: Roles.admin,
    caption: 'יומולדת הבא',
    sqlExpression: () => "cast(birthDate + ((extract(year from age(birthDate)) + 1) * interval '1' year) as date) as nextBirthday",
    allowApiUpdate: false,
    dataControlSettings: () => ({
      readOnly: true,
      inputType: 'date',
      getValue: () => {
        if (!this.nextBirthday.value)
          return;
        return this.nextBirthday.displayValue + " - גיל " + (this.nextBirthday.value.getFullYear() - this.birthDate.value.getFullYear())
      }
    })

  })
  basketType = new BasketId(this.context, 'סוג סל');
  distributionCenter = new DistributionCenterId(this.context);
  familySource = new FamilySourceId(this.context, { includeInApi: true, caption: 'גורם מפנה' });
  socialWorker = new StringColumn('איש קשר לבירור פרטים (עו"ס)');
  socialWorkerPhone1 = new PhoneColumn('עו"ס טלפון 1');
  socialWorkerPhone2 = new PhoneColumn('עו"ס טלפון 2');
  groups = new GroupsColumn(this.context);
  special = new YesNoColumn({ includeInApi: Roles.admin, caption: 'שיוך מיוחד' });
  defaultSelfPickup = new BoolColumn('ברירת מחדל באים לקחת');
  iDinExcel = new StringColumn({ includeInApi: Roles.admin, caption: 'מזהה באקסל' });
  internalComment = new StringColumn({ includeInApi: Roles.admin, caption: 'הערה פנימית - לא תופיע למשנע' });


  address = new StringColumn("כתובת", {
    valueChange: () => {
      if (!this.address.value)
        return;
      let y = parseUrlInAddress(this.address.value);
      if (y != this.address.value)
        this.address.value = y;



    }
  });
  isGpsAddress() {
    return isGpsAddress(this.address.value);
  }
  getAddressDescription() {
    if (this.isGpsAddress()) {
      let r = 'נקודת GPS ';
      let g = this.getGeocodeInformation();
      if (g.getAddress()) {
        r += 'ליד ' + g.getAddress();
      }
      return r;
    }
    return this.address.value;
  }
  floor = new StringColumn('קומה');
  appartment = new StringColumn('דירה');
  entrance = new StringColumn('כניסה');
  city = new StringColumn({ caption: "עיר (מתעדכן אוטומטית)" });
  addressComment = new StringColumn('הנחיות נוספות לכתובת');
  postalCode = new NumberColumn('מיקוד');
  deliveryComments = new StringColumn('הערה שתופיע למשנע');
  addressApiResult = new StringColumn();

  phone1 = new PhoneColumn({ caption: "טלפון 1", dbName: 'phone', valueChange: () => this.delayCheckDuplicateFamilies() });
  phone1Description = new StringColumn('הערות לטלפון 1');
  phone2 = new PhoneColumn({ caption: "טלפון 2", valueChange: () => this.delayCheckDuplicateFamilies() });
  phone2Description = new StringColumn('הערות לטלפון 2');
  phone3 = new PhoneColumn({ caption: "טלפון 3", valueChange: () => this.delayCheckDuplicateFamilies() });
  phone3Description = new StringColumn('הערות לטלפון 3');
  phone4 = new PhoneColumn({ caption: "טלפון 4", valueChange: () => this.delayCheckDuplicateFamilies() });
  phone4Description = new StringColumn('הערות לטלפון 4');



  //callStatus = new CallStatusColumn({ excludeFromApi: !this.context.isAdmin(), caption: 'סטטוס שיחה' });
  //callTime = new changeDate({ excludeFromApi: !this.context.isAdmin(), caption: 'מועד שיחה' });
  //callHelper = new HelperIdReadonly(this.context, { excludeFromApi: !this.context.isAdmin(), caption: 'מי ביצעה את השיחה' });
  //callComments = new StringColumn({ excludeFromApi: !this.context.isAdmin(), caption: 'הערות שיחה' });

  deliverStatus = new DeliveryStatusColumn();
  correntAnErrorInStatus = new BoolColumn({ serverExpression: () => false });
  courier = new HelperId(this.context, () => this.distributionCenter.value, "משנע באירוע");
  courierComments = new StringColumn('הערות שכתב המשנע כשמסר');
  deliveryStatusDate = new changeDate('מועד סטטוס משלוח');
  fixedCourier = new HelperId(this.context, () => this.distributionCenter.value, "משנע קבוע");
  courierAssignUser = new HelperIdReadonly(this.context, () => this.distributionCenter.value, 'מי שייכה למשנע');
  needsWork = new BoolColumn({ caption: 'צריך טיפול/מעקב' });
  needsWorkUser = new HelperIdReadonly(this.context, () => this.distributionCenter.value, 'צריך טיפול - מי עדכן');
  needsWorkDate = new changeDate('צריך טיפול - מתי עודכן');


  courierAssignUserName = new StringColumn({
    caption: 'שם שיוך למשנע',
    serverExpression: async () => (await this.context.for(Helpers).lookupAsync(this.courierAssignUser)).name.value
  });
  courierAssignUserPhone = new PhoneColumn({
    caption: 'טלפון שיוך למשנע',
    serverExpression: async () => (await this.context.for(Helpers).lookupAsync(this.courierAssignUser)).phone.value
  });

  async reloadGeoCoding() {

    let geo = new GeocodeInformation();
    if (!this.__disableGeocoding)
      geo = await GetGeoInformation(this.address.value, this.context);
    this.addressApiResult.value = geo.saveToString();
    this.city.value = '';
    if (geo.ok()) {
      this.city.value = geo.getCity();
      await this.setPostalCodeServerOnly();
    }
    this.addressOk.value = !geo.partialMatch();
    this.addressLongitude.value = geo.location().lng;
    this.addressLatitude.value = geo.location().lat;
    if (this.isGpsAddress()) {
      var j = this.address.value.split(',');
      this.addressLatitude.value = +j[0];
      this.addressLongitude.value = +j[1];
    }
  }

  async setPostalCodeServerOnly() {
    if (!process.env.AUTO_POSTAL_CODE)
      return;
    var geo = this.getGeocodeInformation();
    var house = '';
    var streen = '';
    var location = '';
    for (const c of geo.info.results[0].address_components) {
      switch (c.types[0]) {
        case "street_number":
          house = c.long_name;
          break;
        case "route":
          streen = c.long_name;
          break;
        case "locality":
          location = c.long_name;
          break;
      }
    }
    try {
      let r = await (await fetch.default('https://www.zipy.co.il/findzip', {
        method: 'post',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: 'location=' + encodeURI(location) + '&street=' + encodeURI(streen) + '&house=' + encodeURI(house) + '&entrance=&pob='
      })).json();
      if (r.errors == 0 && r.zip) {
        this.postalCode.value = +r.zip;
      }
    }
    catch (err) {
      console.log(err);
    }
  }

  courierHelpName() {
    if (ApplicationSettings.get(this.context).helpText.value)
      return ApplicationSettings.get(this.context).helpText.value;
    return this.courierAssignUser.displayValue;
  }
  courierHelpPhone() {
    if (ApplicationSettings.get(this.context).helpText.value)
      return ApplicationSettings.get(this.context).helpPhone.displayValue;
    return this.courierAssignUserPhone.displayValue;
  }

  courierAssingTime = new changeDate('מועד שיוך למשנע');




  deliveryStatusUser = new HelperIdReadonly(this.context, () => this.distributionCenter.value, 'מי עדכן את סטטוס המשלוח');

  routeOrder = new NumberColumn();
  previousDeliveryStatus = new DeliveryStatusColumn({
    caption: 'סטטוס משלוח קודם',
    sqlExpression: () => {
      return this.dbNameFromLastDelivery(fde => fde.deliverStatus, "prevStatus");
    }
  });
  previousDeliveryDate = new changeDate({
    caption: 'תאריך משלוח קודם',

    sqlExpression: () => {
      return this.dbNameFromLastDelivery(fde => fde.deliveryStatusDate, "prevDate");
    }
  });
  previousDeliveryComment = new StringColumn({
    caption: 'הערת משלוח קודם',
    sqlExpression: () => {
      return this.dbNameFromLastDelivery(fde => fde.courierComments, "prevComment");
    }
  });

  courierBeenHereBefore = new BoolColumn({
    sqlExpression: () => {
      var sql = new SqlBuilder();

      var fd = this.context.for(FamilyDeliveries).create();
      let f = this;
      sql.addEntity(f, "families");
      return sql.columnWithAlias(sql.case([{ when: [sql.ne(f.courier, "''")], then: sql.build('exists (select 1 from ', fd, ' where ', sql.and(sql.eq(fd.family, f.id), sql.eq(fd.courier, f.courier)), ")") }], false), 'courierBeenHereBefore');
    }
  });
  visibleToCourier = new BoolColumn({
    sqlExpression: () => {
      var sql = new SqlBuilder();
      return sql.case([{ when: [sql.or(sql.gtAny(this.deliveryStatusDate, 'current_date -1'), this.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery))], then: true }], false);

    }
  });


  addressLongitude = new NumberColumn({ decimalDigits: 8 });//שים לב - אם המשתמש הקליד כתובת GPS בכתובת - אז הנקודה הזו תהיה הנקודה שהמשתמש הקליד ולא מה שגוגל מצא
  addressLatitude = new NumberColumn({ decimalDigits: 8 });
  addressOk = new BoolColumn({ caption: 'כתובת תקינה' });

  readyFilter(city?: string, group?: string) {
    let where = this.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery).and(
      this.courier.isEqualTo('')).and(this.distributionCenter.isAllowedForUser());
    if (group)
      where = where.and(this.groups.isContains(group));
    if (city) {
      where = where.and(this.city.isEqualTo(city));
    }

    return where;
  }
  readyAndSelfPickup() {
    let where = this.deliverStatus.isGreaterOrEqualTo(DeliveryStatus.ReadyForDelivery).and(this.deliverStatus.isLessOrEqualTo(DeliveryStatus.SelfPickup)).and(
      this.courier.isEqualTo(''));
    return where;
  }
  private dbNameFromLastDelivery(col: (fd: FamilyDeliveries) => Column<any>, alias: string) {

    let fd = this.context.for(FamilyDeliveries).create();
    let sql = new SqlBuilder();
    return sql.columnInnerSelect(this, {
      select: () => [sql.columnWithAlias(col(fd), alias)],
      from: fd,

      where: () => [sql.eq(fd.family, this.id),
      ],
      orderBy: [{ column: fd.deliveryStatusDate, descending: true }]
    });
  }



  getPreviousDeliveryColumn() {
    return {
      caption: 'סיכום משלוח קודם',
      readonly: true,
      column: this.previousDeliveryStatus,
      dropDown: {
        items: this.previousDeliveryStatus.getOptions()
      },
      getValue: f => {
        if (!f.previousDeliveryStatus.value)
          return '';
        let r = f.previousDeliveryStatus.displayValue;
        if (f.previousDeliveryComment.value) {
          r += ': ' + f.previousDeliveryComment.value
        }
        return r;
      },
      cssClass: f => f.previousDeliveryStatus.getCss()


    } as DataControlSettings<Families>;
  }

  addressByGoogle() {
    let r: DataControlSettings<Families> = {
      caption: 'כתובת כפי שגוגל הבין',
      getValue: f => f.getGeocodeInformation().getAddress()


    }
    return r;
  }
  getDeliveryDescription() {
    switch (this.deliverStatus.value) {
      case DeliveryStatus.ReadyForDelivery:
        if (this.courier.value) {
          let c = this.context.for(Helpers).lookup(this.courier);
          return 'בדרך: ' + c.name.value + (c.eventComment.value ? ' (' + c.eventComment.value + ')' : '') + ', שוייך ' + this.courierAssingTime.relativeDateName();
        }
        break;
      case DeliveryStatus.Success:
      case DeliveryStatus.SuccessLeftThere:
      case DeliveryStatus.FailedBadAddress:
      case DeliveryStatus.FailedNotHome:
      case DeliveryStatus.FailedOther:
        let duration = '';
        if (this.courierAssingTime.value && this.deliveryStatusDate.value)
          duration = ' תוך ' + Math.round((this.deliveryStatusDate.value.valueOf() - this.courierAssingTime.value.valueOf()) / 60000) + " דק'";
        return this.deliverStatus.displayValue + (this.courierComments.value ? ", " + this.courierComments.value + " - " : '') + (this.courier.value ? ' על ידי ' + this.courier.getValue() : '') + ' ' + this.deliveryStatusDate.relativeDateName() + duration;

    }
    return this.deliverStatus.displayValue;
  }
  getShortDeliveryDescription() {
    return Families.staticGetShortDescription(this.deliverStatus, this.deliveryStatusDate, this.courier, this.courierComments);
  }
  static staticGetShortDescription(deliverStatus: DeliveryStatusColumn, deliveryStatusDate: changeDate, courier: HelperId, courierComments: StringColumn) {
    let r = deliverStatus.displayValue + " ";
    if (DeliveryStatus.IsAResultStatus(deliverStatus.value)) {
      if (deliveryStatusDate.value.valueOf() < new Date().valueOf() - 7 * 86400 * 1000)
        r += "ב " + deliveryStatusDate.value.toLocaleDateString("he-il");
      else
        r += deliveryStatusDate.relativeDateName();
      if (courierComments.value) {
        r += ": " + courierComments.value;
      }
      if (courier.value && deliverStatus.value != DeliveryStatus.SelfPickup && deliverStatus.value != DeliveryStatus.SuccessPickedUp)
        r += ' ע"י ' + courier.getValue();
    }
    return r;
  }


  createDate = new changeDate({ includeInApi: Roles.admin, caption: 'מועד הוספה' });
  createUser = new HelperIdReadonly(this.context, () => this.distributionCenter.value, { includeInApi: Roles.admin, caption: 'משתמש מוסיף' });
  lastUpdateDate = new changeDate({ includeInApi: Roles.admin, caption: 'מועד עדכון אחרון' });




  openWaze() {
    //window.open('https://waze.com/ul?ll=' + this.getGeocodeInformation().getlonglat() + "&q=" + encodeURI(this.address.value) + 'export &navigate=yes', '_blank');
    window.open('waze://?ll=' + this.getGeocodeInformation().getlonglat() + "&q=" + encodeURI(this.address.value) + '&navigate=yes');
  }
  openGoogleMaps() {
    window.open('https://www.google.com/maps/search/?api=1&hl=iw&query=' + this.address.value, '_blank');
  }
  showOnGoogleMaps() {
    window.open('https://maps.google.com/maps?q=' + this.getGeocodeInformation().getlonglat() + '&hl=iw', '_blank');
  }
  showOnGovMap() {
    let x = this.getGeocodeInformation().location();
    window.open('https://www.govmap.gov.il/?q=' + this.address.value + '&z=10', '_blank');
  }



  private _lastString: string;
  private _lastGeo: GeocodeInformation;
  getGeocodeInformation() {
    if (this._lastString == this.addressApiResult.value)
      return this._lastGeo ? this._lastGeo : new GeocodeInformation();
    this._lastString = this.addressApiResult.value;
    return this._lastGeo = GeocodeInformation.fromString(this.addressApiResult.value);
  }

  static SendMessageToBrowsers = (s: string, context: Context, distCenter: string) => { };
  static GetUpdateMessage(n: FamilyUpdateInfo, updateType: number, courierName: string) {
    switch (updateType) {
      case 1:
        switch (n.deliverStatus.value) {
          case DeliveryStatus.ReadyForDelivery:
            break;
          case DeliveryStatus.Success:
          case DeliveryStatus.SuccessLeftThere:
          case DeliveryStatus.FailedBadAddress:
          case DeliveryStatus.FailedNotHome:
          case DeliveryStatus.FailedOther:
            let duration = '';
            if (n.courierAssingTime.value && n.deliveryStatusDate.value)
              duration = ' תוך ' + Math.round((n.deliveryStatusDate.value.valueOf() - n.courierAssingTime.value.valueOf()) / 60000) + " דק'";
            return n.deliverStatus.displayValue + (n.courierComments.value ? ", " + n.courierComments.value + " - " : '') + translate(' למשפחת ') + n.name.value + ' על ידי ' + courierName + duration + "!!";
        }
        return translate('משפחת ') + n.name.value + ' עודכנה ל' + n.deliverStatus.displayValue;
      case 2:
        if (n.courier.value)
          return translate('משפחת ') + n.name.value + ' שוייכה ל' + courierName;
        else
          return translate("בוטל השיוך למשפחת ") + n.name.value;
    }
    return n.deliverStatus.displayValue;
  }
  tzDelay: delayWhileTyping;
  private delayCheckDuplicateFamilies() {
    if (this._disableAutoDuplicateCheck)
      return;
    if (this.context.onServer)
      return;
    if (!this.tzDelay)
      this.tzDelay = new delayWhileTyping(1000);
    this.tzDelay.do(async () => {
      this.checkDuplicateFamilies();

    });

  }
  _disableAutoDuplicateCheck = false;
  duplicateFamilies: duplicateFamilyInfo[] = [];
  validatePhone(col: PhoneColumn) {
    if (!col.value || col.value == '')
      return;
    if (col.displayValue.startsWith("05") || col.displayValue.startsWith("07")) {
      if (col.displayValue.length != 12) {
        col.validationError = 'מספר טלפון אינו תקין';
      }

    } else if (col.displayValue.startsWith('0')) {
      if (col.displayValue.length != 11) {
        col.validationError = 'מספר טלפון אינו תקין';
      }
    }
    else {
      col.validationError = 'מספר טלפון אינו תקין';
    }
  }
  async checkDuplicateFamilies() {
    this.duplicateFamilies = await Families.checkDuplicateFamilies(this.name.value, this.tz.value, this.tz2.value, this.phone1.value, this.phone2.value, this.phone3.value, this.phone4.value, this.id.value);
    this.tz.validationError = undefined;
    this.tz2.validationError = undefined;
    this.phone1.validationError = undefined;
    this.phone2.validationError = undefined;
    this.phone3.validationError = undefined;
    this.phone4.validationError = undefined;
    this.name.validationError = undefined;
    let foundExactName = false;
    for (const d of this.duplicateFamilies) {
      let errorText = translate('ערך כבר קיים למשפחת "') + d.name + '" בכתובת ' + d.address;
      if (d.tz)
        this.tz.validationError = errorText;
      if (d.tz2)
        this.tz2.validationError = errorText;
      if (d.phone1)
        this.phone1.validationError = errorText;
      if (d.phone2)
        this.phone2.validationError = errorText;
      if (d.phone3)
        this.phone3.validationError = errorText;
      if (d.phone4)
        this.phone4.validationError = errorText;
      if (d.nameDup && this.name.value != this.name.originalValue) {
        if (!foundExactName)
          this.name.validationError = errorText;
        if (this.name.value && d.name && this.name.value.trim() == d.name.trim())
          foundExactName = true;
      }
    }
    this.validatePhone(this.phone1);
    this.validatePhone(this.phone2);
    this.validatePhone(this.phone3);
    this.validatePhone(this.phone4);


  }
  @ServerFunction({ allowed: Roles.admin, blockUser: false })
  static async checkDuplicateFamilies(name: string, tz: string, tz2: string, phone1: string, phone2: string, phone3: string, phone4: string, id: string, exactName: boolean = false, context?: Context, db?: SqlDatabase) {
    let result: duplicateFamilyInfo[] = [];

    var sql = new SqlBuilder();
    var f = context.for(Families).create();

    let compareAsNumber = (col: Column<string>, value: string) => {
      return sql.and(sql.eq(sql.extractNumber(col), sql.extractNumber(sql.str(value))), sql.build(sql.extractNumber(sql.str(value)), ' <> ', 0));
    };
    let tzCol = sql.or(compareAsNumber(f.tz, tz), compareAsNumber(f.tz2, tz));
    let tz2Col = sql.or(compareAsNumber(f.tz, tz2), compareAsNumber(f.tz2, tz2));
    let phone1Col = sql.or(compareAsNumber(f.phone1, phone1), compareAsNumber(f.phone2, phone1), compareAsNumber(f.phone3, phone1), compareAsNumber(f.phone4, phone1));
    let phone2Col = sql.or(compareAsNumber(f.phone1, phone2), compareAsNumber(f.phone2, phone2), compareAsNumber(f.phone3, phone2), compareAsNumber(f.phone4, phone2));
    let phone3Col = sql.or(compareAsNumber(f.phone1, phone3), compareAsNumber(f.phone2, phone3), compareAsNumber(f.phone3, phone3), compareAsNumber(f.phone4, phone3));
    let phone4Col = sql.or(compareAsNumber(f.phone1, phone4), compareAsNumber(f.phone2, phone4), compareAsNumber(f.phone3, phone4), compareAsNumber(f.phone4, phone4));
    let nameCol = 'false';
    if (name && name.trim().length > 0)
      if (exactName)
        nameCol = sql.build('trim(', f.name, ') =  ', sql.str(name.trim()));
      else
        nameCol = sql.build('trim(', f.name, ') like  ', sql.str('%' + name.trim() + '%'));


    let sqlResult = await db.execute(sql.query({
      select: () => [f.id,
      f.name,
      f.address,
      sql.columnWithAlias(tzCol, 'tz'),
      sql.columnWithAlias(tz2Col, 'tz2'),
      sql.columnWithAlias(phone1Col, 'phone1'),
      sql.columnWithAlias(phone2Col, 'phone2'),
      sql.columnWithAlias(phone3Col, 'phone3'),
      sql.columnWithAlias(phone4Col, 'phone4'),
      sql.columnWithAlias(nameCol, 'nameDup')

      ],

      from: f,
      where: () => [f.distributionCenter.isAllowedForUser(), sql.or(tzCol, tz2Col, phone1Col, phone2Col, phone3Col, phone4Col, nameCol), sql.ne(f.id, sql.str(id))]
    }));
    if (!sqlResult.rows || sqlResult.rows.length < 1)
      return [];

    for (const row of sqlResult.rows) {
      result.push({
        id: row[sqlResult.getColumnKeyInResultForIndexInSelect(0)],
        name: row[sqlResult.getColumnKeyInResultForIndexInSelect(1)],
        address: row[sqlResult.getColumnKeyInResultForIndexInSelect(2)],
        tz: row[sqlResult.getColumnKeyInResultForIndexInSelect(3)],
        tz2: row[sqlResult.getColumnKeyInResultForIndexInSelect(4)],
        phone1: row[sqlResult.getColumnKeyInResultForIndexInSelect(5)],
        phone2: row[sqlResult.getColumnKeyInResultForIndexInSelect(6)],
        phone3: row[sqlResult.getColumnKeyInResultForIndexInSelect(7)],
        phone4: row[sqlResult.getColumnKeyInResultForIndexInSelect(8)],
        nameDup: row[sqlResult.getColumnKeyInResultForIndexInSelect(9)]

      });
    }
    return result;

  }
}

export class FamilyId extends IdColumn { }

export interface duplicateFamilyInfo {
  id: string;
  name: string;
  address: string;
  tz: boolean;
  tz2: boolean;
  phone1: boolean;
  phone2: boolean;
  phone3: boolean;
  phone4: boolean;
  nameDup: boolean;
}

export interface FamilyUpdateInfo {
  name: StringColumn,
  courier: HelperId,
  deliverStatus: DeliveryStatusColumn,
  courierAssingTime: changeDate,
  deliveryStatusDate: changeDate,
  courierComments: StringColumn
}

export function parseAddress(s: string) {
  let r = {

  } as parseAddressResult;


  let extractSomething = (what: string) => {
    let i = s.indexOf(what);
    if (i >= 0) {
      let value = '';
      let index = 0;
      for (index = i + what.length; index < s.length; index++) {
        const element = s[index];
        if (element != ' ' && element != ',') {
          value += element;
        }
        else if (value) {

          break;
        }
      }
      let after = s.substring(index + 1, 1000);
      if (s[index] == ' ')
        after = ' ' + after;
      if (s[index] == ',')
        after = ',' + after;
      s = s.substring(0, i) + after;
      return value.trim();
    }
  }
  r.dira = extractSomething('דירה');
  if (!r.dira) {
    r.dira = extractSomething('/');
  }
  r.floor = extractSomething('קומה');
  r.knisa = extractSomething('כניסה');


  r.address = s.trim();
  return r;
}
export interface parseAddressResult {
  address: string;
  dira?: string;
  floor?: string;
  knisa?: string;
}
export class GroupsColumn extends StringColumn {
  removeGroup(group: string) {
    let groups = this.value.split(",").map(x => x.trim());
    let index = groups.indexOf(group);
    if (index >= 0) {
      groups.splice(index, 1);
      this.value = groups.join(", ");
    }
  }
  addGroup(group: string) {
    if (this.value)
      this.value += ', ';
    else
      this.value = '';
    this.value += group;
  }
  constructor(private context: Context) {
    super({
      caption: 'שיוך לקבוצת חלוקה',
      includeInApi: Roles.admin,
      dataControlSettings: () => ({
        width: '300',
        click: () => {
          this.context.openDialog(UpdateGroupDialogComponent, s => {
            s.init({
              groups: this.value,
              ok: x => this.value = x
            })
          });
        }
      })
    });
  }
  selected(group: string) {
    if (!this.value)
      return false;
    return this.value.indexOf(group) >= 0;
  }

}
export function parseUrlInAddress(address: string) {
  let x = address.toLowerCase();
  let search = 'https://maps.google.com/maps?q=';
  if (x.startsWith(search)) {
    x = x.substring(search.length, 1000);
    let i = x.indexOf('&')
    if (i >= 0) {
      x = x.substring(0, i);
    }
    x = x.replace('%2c', ',');
    return x;
  } else if (x.startsWith('https://www.google.com/maps/place/')) {
    let r = x.split('!3d');
    if (r.length > 0) {
      x = r[r.length - 1];
      let j = x.split('!4d')
      x = j[0] + ',' + j[1];
      let i = x.indexOf('!');
      if (i > 0) {
        x = x.substring(0, i);
      }
      return leaveOnlyNumericChars(x);

    }
  } else if (x.indexOf('מיקום:') >= 0) {
    let j = x.substring(x.indexOf('מיקום:') + 6);
    let k = j.indexOf('דיוק');
    if (k > 0) {
      j = j.substring(0, k);
      j = leaveOnlyNumericChars(j);
      if (j.indexOf(',') > 0)
        return j;
    }


  }
  if (isGpsAddress(address)) {
    let x = address.split(',');
    return (+x[0]).toFixed(6) + ',' + (+x[1]).toFixed(6);
  }

  return address;
}

function leaveOnlyNumericChars(x: string) {
  for (let index = 0; index < x.length; index++) {
    switch (x[index]) {
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      case '0':
      case '.':
      case ',':
      case ' ':
        break;
      default:
        return x.substring(0, index);
    }
  }
  return x;
}
function isGpsAddress(address: string) {
  if (!address)
    return false;
  let x = leaveOnlyNumericChars(address);
  if (x == address && x.indexOf(',') > 5)
    return true;
}

export async function iterateFamilies( context: Context, where: (f: Families) => FilterBase, what: (f: Families) => void,count?: number) {
  let updated = 0;
  let pageSize = 200;
  if (count===undefined){
      count = await context.for(Families).count(where);
  }
  let pt = new PromiseThrottle(10);
  for (let index = (count / pageSize); index >= 0; index--) {
      let rows = await context.for(Families).find({ where, limit: pageSize, page: index, orderBy: f => [f.id] });
      //console.log(rows.length);
      for (const f of await rows) {
          f._disableMessageToUsers = true;
          what(f);
          await pt.push(f.save());
          updated++;
      }
  }
  await pt.done();
  return updated;
}

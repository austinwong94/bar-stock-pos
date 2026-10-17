import assert from 'node:assert/strict';
import path from 'node:path';

export async function testStaffWorkflows(browser,url,out) {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const shots=async(name,modal=false)=>{
    for(const width of [390,320,768,1024,1440]) {
      await page.setViewportSize({width,height:width===320?640:width===1024?768:width===768?1024:width<768?844:1000});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits at '+width);
      const small=await page.locator('.staff-workspace button:visible, .staff-workspace select:visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<43.5).map(n=>n.textContent));
      assert.deepEqual(small,[],name+' has 44px touch targets');
      if(modal) {
        assert(await page.getByRole('dialog').locator('footer').evaluate(el=>{const box=el.getBoundingClientRect();return box.top>=0 && box.bottom<=innerHeight;}),name+' keeps its confirmation footer in view');
      }
      await page.screenshot({path:path.join(out,name+'-'+width+'.png'),animations:'disabled'});
    }
    await page.setViewportSize({width:390,height:844});
  };
  try {
    await page.goto(url);
    assert(await page.evaluate(async()=>(await import('/src/lib/supabase.ts')).isDemoMode),'Staff tests require isolated practice data');
    await page.getByRole('button',{name:/Austin \(Owner\)/}).click();
    await page.locator('main').waitFor();
    await page.waitForTimeout(200);
    if(await page.getByRole('button',{name:'Later',exact:true}).count())await page.getByRole('button',{name:'Later',exact:true}).click();
    await page.goto(url+'/#/boarding');
    await page.locator('[data-passenger]').first().waitFor();
    const reminder=page.getByRole('complementary',{name:'Daily Pax Reminder',exact:true});
    await reminder.waitFor();
    assert.equal(await reminder.evaluate(el=>getComputedStyle(el).position),'static','Pax reminder does not cover staff actions');
    await page.screenshot({path:path.join(out,'staff-pax-banner-390.png')});
    await page.getByRole('button',{name:'Hide pax reminder',exact:true}).click();
    const guest=await page.evaluate(async()=>{
      const {db}=await import('/src/lib/demoBackend.ts');
      // Reserve room in this isolated fixture for the later assignment test.
      db.boats[0].capacity_pax=43;
      const first=Array.from(document.querySelectorAll('[data-passenger]')).find(el=>!el.querySelector('button[aria-label^="Check In "]').disabled).dataset.passenger;
      const passenger=db.trip_passengers.find(g=>g.id===first);
      const tourist=db.tourists.find(g=>g.id===passenger.tourist_id);
      tourist.full_name='Alexandria Nur Aisyah Binti Muhammad';
      return {id:first,name:tourist.full_name};
    });
    await page.getByRole('button',{name:'Refresh Attendance',exact:true}).click();
    await page.getByRole('button',{name:'Check In '+guest.name,exact:true}).waitFor();
    await shots('staff-boarding');
    await page.getByLabel('Find Guest',{exact:true}).fill('Alexandria');
    assert((await page.locator('[data-passenger]').count())>=1,'Search keeps the matching guest and their whole group visible');
    await page.evaluate(async()=>{
      const {supabase}=await import('/src/lib/supabase.ts');
      window.staffOriginalRpc=supabase.rpc.bind(supabase);
      supabase.rpc=(name,args)=>name==='record_staff_attendance_checked'?Promise.resolve({data:null,error:{message:'Connection interrupted. Try again.'}}):window.staffOriginalRpc(name,args);
    });
    await page.getByRole('button',{name:'Check In '+guest.name,exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Connection interrupted.'}).waitFor();
    assert(await page.locator('[data-passenger="'+guest.id+'"]').isVisible(),'Failed saves do not falsely mark a guest as checked in');
    await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');supabase.rpc=window.staffOriginalRpc;});
    await page.getByRole('button',{name:'Check In '+guest.name,exact:true}).click();
    await page.waitForFunction(name=>document.querySelector('[aria-label="Check In '+name+'"]').disabled,guest.name);
    assert(await page.locator('[data-passenger="'+guest.id+'"]').isVisible(),'Check-in keeps the guest visible in All Guests');
    assert(await page.getByRole('button',{name:'Check In '+guest.name,exact:true}).isDisabled(),'A saved check-in is visibly marked and cannot be toggled by accident');
    await page.getByLabel('Find Guest',{exact:true}).fill('');
    await page.getByRole('button',{name:/^Waiting/}).click();
    await page.getByRole('button',{name:/^Check In All Waiting/}).click();
    const reviewed=await page.getByRole('dialog').locator('li').count();
    await shots('staff-confirmation',true);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:/^Check In All Waiting/}).click();
    assert.equal(await page.getByRole('dialog').locator('li').count(),reviewed,'Dismissing confirmation does not change attendance');
    await page.getByRole('dialog').getByRole('button',{name:/^Check In \d+ Guests$/}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});

    await page.getByRole('navigation',{name:'Section Navigation'}).getByRole('link',{name:'Activities',exact:true}).click();
    await page.getByRole('heading',{name:'Island Activities',exact:true}).waitFor();
    await page.getByLabel('Activity for '+guest.name,{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Activity for '+guest.name,{exact:true}).locator('select').count(),0,'Activity choices are direct buttons');
    await page.getByLabel('Activity for '+guest.name,{exact:true}).getByRole('button').first().click();
    await page.getByRole('status').filter({hasText:'Attendance saved.'}).waitFor();
    await shots('staff-activity');
    await page.getByRole('button',{name:'Roll Call',exact:true}).click();
    await page.getByRole('button',{name:'Mark Joined '+guest.name,exact:true}).click();
    await page.waitForFunction(name=>document.querySelector('[aria-label="Mark Joined '+name+'"]').disabled,guest.name);
    await shots('staff-roll-call');
    await page.getByRole('button',{name:'Return',exact:true}).click();
    await page.getByRole('button',{name:'Mark Returned '+guest.name,exact:true}).click();
    await page.waitForFunction(name=>document.querySelector('[aria-label="Mark Returned '+name+'"]').disabled,guest.name);
    await shots('staff-return');
    await page.reload();
    await page.getByRole('button',{name:'Return',exact:true}).click();
    await page.getByRole('button',{name:'Mark Returned '+guest.name,exact:true}).waitFor();
    assert(await page.getByRole('button',{name:'Mark Returned '+guest.name,exact:true}).isDisabled(),'Return attendance survives reload');
    assert(await page.locator('[data-passenger="'+guest.id+'"]').isVisible(),'Returned guest remains in the attendance list');
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.screenshot({path:path.join(out,'staff-navigation-390.png')});
    await page.getByRole('button',{name:'BM',exact:true}).last().click();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await shots('staff-return-malay');
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.getByRole('button',{name:'EN',exact:true}).last().click();
    await page.getByRole('button',{name:'Close',exact:true}).click();

    await page.getByRole('navigation',{name:'Section Navigation'}).getByRole('link',{name:'Boats',exact:true}).click();
    await page.getByRole('heading',{name:'Boat Board',exact:true}).waitFor();
    const booking=await page.evaluate(async()=>{
      const {supabase}=await import('/src/lib/supabase.ts');
      const {data,error}=await supabase.rpc('save_booking',{p_booking:{service_date:document.querySelector('[aria-label="Service Date"]').value,lead_name:'Siti Nur Aisyah and Family',pickup_required:false},p_tourists:[{full_name:'Siti Nur Aisyah',age_band:'adult',is_lead:true},{full_name:'Muhammad Hakim',age_band:'adult',is_lead:false}]});
      if(error)throw error;return data;
    });
    await page.reload();
    await page.getByRole('button',{name:'Assign Boat for Siti Nur Aisyah and Family',exact:true}).click();
    assert(await page.getByRole('button',{name:'Confirm Assignment',exact:true}).isDisabled(),'Assignment needs an explicit boat choice');
    const available=page.getByRole('dialog').getByRole('radio').filter({visible:true});
    const choices=await available.count();let chosen=false;
    for(let i=0;i<choices;i++)if(await available.nth(i).isEnabled()){await available.nth(i).check();chosen=true;break;}
    assert(chosen,'At least one demo boat has room for the whole group');
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Confirm Assignment'))?.disabled);
    await shots('staff-assign-boat',true);
    await page.getByRole('button',{name:'Confirm Assignment',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.reload();
    await page.getByRole('button',{name:/^Boats & Crew/}).click();
    await page.locator('[data-booking="'+booking+'"]').waitFor();
    assert(await page.locator('[data-booking="'+booking+'"]').isVisible(),'Confirmed assignment survives reload');
    await shots('staff-boat-board');
    await page.getByRole('button',{name:/^Assign Crew for /}).first().click();
    await page.getByLabel('Departure Time',{exact:true}).fill('09:15');
    await shots('staff-assign-crew',true);
    await page.getByRole('button',{name:'Save Crew',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:/^Assign Crew for /}).first().click();
    assert.equal(await page.getByLabel('Departure Time',{exact:true}).inputValue(),'09:15','Explicit crew save persists the departure time');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    assert.deepEqual(errors,[],'Staff workflows have no browser errors');
    const guide=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    try {
      await guide.goto(url);
      await guide.getByRole('button',{name:/Mei.*Tour Guide/}).click();
      await guide.goto(url+'/#/boarding');
      await guide.locator('[data-passenger]').first().waitFor();
      const visible=await guide.evaluate(async()=>{
        const {supabase}=await import('/src/lib/supabase.ts');
        const {db}=await import('/src/lib/demoBackend.ts');
        const rows=(await supabase.from('trip_manifest').select('*')).data;
        return rows.every(row=>db.boat_assignments.find(a=>a.id===row.assignment_id)?.guide_employee_id==='em-mei');
      });
      assert(visible,'Guide only sees passenger lists for assigned boats');
      await guide.locator('button[aria-label^="Check In "]:enabled').first().click();
      await guide.getByRole('status').filter({hasText:'Checked In'}).waitFor();
      assert.equal(await guide.getByRole('complementary',{name:'Daily Pax Reminder'}).count(),0,'Guide view excludes kitchen-only reminders');
      await guide.screenshot({path:path.join(out,'staff-guide-390.png')});
    } finally {await guide.close();}
    console.log('PASS mobile staff workflows: check-in, group confirmation, activity, return, reload, Malay, touch assignment and crew save');
  } catch(error) {
    await page.screenshot({path:path.join(out,'staff-test-failure.png'),fullPage:true});throw error;
  } finally {await page.close();}
}

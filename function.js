import { mdiStarOutline, mdiStar } from '@mdi/js';

console.log(mdiStarOutline); // M...Z Path data
setInterval(function(){
    document.querySelector('path').setAttribute('d', mdiStarOutline);
},500) // TODO: remove this later and substitute with proper

console.log('yo');
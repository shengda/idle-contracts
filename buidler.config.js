const BigNumber = require('bignumber.js');
require('dotenv').config();
const path = require("path");

usePlugin("@nomiclabs/buidler-truffle5")
usePlugin("@nomiclabs/buidler-web3");

const INFURA_KEY = process.env["INFURA_KEY"];
const BNify = s => new BigNumber(String(s));

task("accounts", "Prints a list of the available accounts", async () => {
  const accounts = await ethereum.send("eth_accounts");
  const balances = await Promise.all(accounts.map(a => web3.eth.getBalance(a)));
  console.log("Accounts:", balances.map((b, i) => ({address: accounts[i], balance: web3.utils.fromWei(b, "ether")})));
});

task("iDAI", "Call method on iDAI contract. eg `npx buidler iDAI --method tokenPrice`")
  .addParam("method", "The method of the contract")
  .setAction(async taskArgs => {
    const iERC20Fulcrum = artifacts.require('iERC20Fulcrum');
    const iDAI = await iERC20Fulcrum.at('0x14094949152eddbfcd073717200da82fed8dc960'); // mainnet
    const res = await iDAI[taskArgs.method].call();

    console.log(`RES: ${res.toString()}`)
  });

task("cDAI", "Call method on cDAI contract. eg `npx buidler cDAI --method exchangeRateStored`")
  .addParam("method", "The method of the contract")
  .setAction(async taskArgs => {
    const cERC20 = artifacts.require('CERC20');
    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const res = await cDAI[taskArgs.method].call();

    console.log(`RES: ${res.toString()}`)
  });

task("cDAI:rate", "cDAI to DAI rate")
  .setAction(async taskArgs => {
    const cERC20 = artifacts.require('CERC20');
    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc');
    let res = await cDAI.exchangeRateStored.call();
    res = BNify(1e18).div(BNify(res).div(1e18)).div(1e8);
    console.log(`RES: ${res.toString()}`)
  });

// gives same results as autoNextSupplyRateData
task("iDAI:manualNextRateData", "iDAI calculate next supplyRate given a supplyAmount")
  .addParam("amount", "The amount provided, eg '100000' for 100000 DAI ")
  .setAction(async taskArgs => {
    const ERC20 = artifacts.require('ERC20');
    const iERC20Fulcrum = artifacts.require('iERC20Fulcrum');
    const iDAI = await iERC20Fulcrum.at('0x14094949152eddbfcd073717200da82fed8dc960'); // mainnet

    const newDAIAmount = BNify(taskArgs.amount).times(1e18);

    let promises = [
      iDAI.supplyInterestRate.call(),
      iDAI.avgBorrowInterestRate.call(),
      iDAI.totalAssetSupply.call(),
      iDAI.totalAssetBorrow.call(),
      iDAI.rateMultiplier.call(),
      iDAI.baseRate.call(),
    ];
    const res = await Promise.all(promises);
    const [
      supplyRate, borrowRate, totalAssetSupply,
      totalAssetBorrow, rateMultiplier, baseRate,
    ] = res;

    const currUtilizationRate = BNify(totalAssetBorrow).times(1e20).div(BNify(totalAssetSupply));

    console.log(`CONTRACT DATA:`);
    console.log(`${supplyRate.toString()} supplyRate`);
    console.log(`${BNify(supplyRate).div(1e18).toString()}% supplyRate %`);
    console.log(`${borrowRate.toString()} borrowRate`);
    console.log(`${BNify(borrowRate).div(1e18).toString()}% borrowRate %`);
    console.log(`${totalAssetBorrow.toString()} totalAssetBorrow`);
    console.log(`${totalAssetSupply.toString()} totalAssetSupply`);
    console.log(`${BNify(totalAssetBorrow).div(1e18).toString()} totalAssetBorrow DAI`);
    console.log(`${BNify(totalAssetSupply).div(1e18).toString()} totalAssetSupply DAI`);
    console.log(`${currUtilizationRate.toString()} currUtilizationRate`);
    console.log(`##############`);

    const newUtilizationRate = BNify(totalAssetBorrow).times(1e20).div(BNify(totalAssetSupply).plus(newDAIAmount));
    const nextBorrowInterestRate = BNify(newUtilizationRate)
        .times(BNify(rateMultiplier))
        .div(BNify(1e20))
        .plus(BNify(baseRate));

    const targetSupplyRateNoFee = BNify(borrowRate).times(BNify(totalAssetSupply).div(BNify(totalAssetSupply).plus(newDAIAmount))).times(BNify(totalAssetBorrow).div(BNify(totalAssetSupply).plus(newDAIAmount)))

    console.log(`SUPPLYING ${BNify(newDAIAmount).div(1e18).toString()} DAI`);
    console.log(`${nextBorrowInterestRate.toString()} nextBorrowInterestRate`);
    console.log(`${BNify(nextBorrowInterestRate).div(1e18).toString()}% nextBorrowInterestRate %`);
    console.log(`${targetSupplyRateNoFee.toString()} targetSupplyRateNoFee`);
    console.log(`${BNify(targetSupplyRateNoFee).div(1e18).toString()}% targetSupplyRateNoFee %`);
  });

task("iDAI:autoNextSupplyRateData", "iDAI get next supplyRate given a supplyAmount from fulcrum")
  .addParam("amount", "The amount provided, eg '100000' for 100000 DAI ")
  .setAction(async taskArgs => {
    const ERC20 = artifacts.require('ERC20');
    const iERC20Fulcrum = artifacts.require('iERC20Fulcrum');
    const iDAI = await iERC20Fulcrum.at('0x14094949152eddbfcd073717200da82fed8dc960'); // mainnet
    const newDAIAmount = BNify(taskArgs.amount).times(1e18);

    let promises = [
      iDAI.nextSupplyInterestRate.call(web3.utils.toBN(newDAIAmount)),
    ];
    const res = await Promise.all(promises);
    const [supplyRate] = res;

    console.log(`${supplyRate.toString()} supplyRate`);
    console.log(`${BNify(supplyRate).div(1e18).toString()}% supplyRate %`);
    // 6.608818741649654856% supplyRate % with 100000 DAI
  });

task("iDAI:manualAmountToRate", "iDAI calculate max amount lendable with a min target supply rate")
  .addParam("rate", "The target rate, eg '8' for 8% ")
  .setAction(async taskArgs => {
    const ERC20 = artifacts.require('ERC20');
    const iERC20Fulcrum = artifacts.require('iERC20Fulcrum');
    const iDAI = await iERC20Fulcrum.at('0x14094949152eddbfcd073717200da82fed8dc960'); // mainnet
    // TO REMOVE
    const newDAIAmount = BNify('100000').times(BNify('1e18'));

    let promises = [
      iDAI.supplyInterestRate.call(),
      iDAI.avgBorrowInterestRate.call(),
      iDAI.totalAssetSupply.call(),
      iDAI.totalAssetBorrow.call(),
      iDAI.spreadMultiplier.call(),
      iDAI.nextSupplyInterestRate.call(web3.utils.toBN(newDAIAmount))
    ];

    const res = await Promise.all(promises);
    let [supplyRate, borrowRate, totalAssetSupply, totalAssetBorrow, spreadMultiplier, nextSupplyInterestRate] = res;

    supplyRate = BNify(supplyRate);
    borrowRate = BNify(borrowRate);
    totalAssetSupply = BNify(totalAssetSupply);
    totalAssetBorrow = BNify(totalAssetBorrow);
    spreadMultiplier = BNify(spreadMultiplier);
    nextSupplyInterestRate = BNify(nextSupplyInterestRate);

    const targetSupplyRatePerYear = BNify(taskArgs.rate).times(BNify(1e18));
    const utilizationRate = BNify(totalAssetBorrow).div(BNify(totalAssetSupply));

    console.log(`CONTRACT current DATA:`);
    console.log(`${BNify(supplyRate).div(1e18).toString()}% supplyRate %`);
    console.log(`${BNify(borrowRate).div(1e18).toString()}% borrowRate %`);
    console.log(`${BNify(totalAssetSupply).div(1e18).toString()} totalAssetSupply DAI`);
    console.log(`${BNify(totalAssetBorrow).div(1e18).toString()} totalAssetBorrow DAI`);
    console.log(`${spreadMultiplier.toString()} spreadMultiplier`);
    console.log(`${utilizationRate.toString()} utilizationRate`);
    console.log(`${nextSupplyInterestRate.div(1e18).toString()}% nextSupplyInterestRate with ${newDAIAmount} DAI`);
    console.log(`##############`);

    // aggregate_rate_of_all_fixed_interest_loans = borrowInterstRate()
    // currentSupplyInterestRate = aggregate_rate_of_all_fixed_interest_loans * B/S * (1-spread)
    // targetSupplyRate = aggregate_rate_of_all_fixed_interest_loans * S / (S + dS) * B/(S+dS) * (1-spread)

    const a = borrowRate;
    const b = totalAssetBorrow;
    const s = totalAssetSupply;
    const o = spreadMultiplier; // BNify('1e20').minus(BNify(spreadMultiplier));
    const x = newDAIAmount;   // 100000 DAI
    const k = BNify('1e20');
    const q = targetSupplyRatePerYear; // targetSupplyRate given

    const currentSupplyInterestRate = a.times(b.div(s));
    const targetSupplyRate = a.times(s.div(s.plus(x))).times(b.div(s.plus(x)))

    const currentSupplyInterestRateWithFee = a.times(b.div(s))
      .times(o).div(k); // counting fee (spreadMultiplier)

    const targetSupplyRateWithFee = a.times(s.div(s.plus(x)))
      .times(b.div(s.plus(x)))
      .times(o).div(k); // counting fee (spreadMultiplier)

    // solve for newDAIAmount with a given rate

    // q = a * (s / (s + x)) * (b / (s + x))
    // with wolfram for x
    // x = (sqrt(a) sqrt(b) sqrt(s) - sqrt(q) s)/sqrt(q)
    const maxDAIAmount = a.sqrt().times(b.sqrt()).times(s.sqrt()).minus(q.sqrt().times(s)).div(q.sqrt());
    // q = a * (s / (s + x)) * (b / (s + x)) * o / k
    // with wolfram for x
    // x = (sqrt(a) sqrt(b) sqrt(o) sqrt(s) - sqrt(k) sqrt(q) s)/(sqrt(k) sqrt(q))
    const maxDAIAmountWithFee = a.sqrt().times(b.sqrt()).times(o.sqrt()).times(s.sqrt()).minus(k.sqrt().times(q.sqrt()).times(s)).div(k.sqrt().times(q.sqrt()));

    console.log(`${currentSupplyInterestRate.div(1e18).toString()} currentSupplyInterestRate`);
    console.log(`${targetSupplyRate.div(1e18).toString()} targetSupplyRate`);
    console.log(`${currentSupplyInterestRateWithFee.div(1e18).toString()} currentSupplyInterestRateWithFee`);
    console.log(`${targetSupplyRateWithFee.div(1e18).toString()} targetSupplyRateWithFee`);
    console.log(`${maxDAIAmount.div(1e18).toString()} maxDAIAmount`);
    console.log(`${maxDAIAmountWithFee.div(1e18).toString()} maxDAIAmountWithFee`);
  });

task("idleDAI:rebalanceCalc", "idleDAI rebalance calculations")
  .addParam("amount", "The amount provided, eg '100000' for 100000 DAI ")
  .setAction(async taskArgs => {
    const ERC20 = artifacts.require('ERC20');
    const iERC20Fulcrum = artifacts.require('iERC20Fulcrum');
    const iDAI = await iERC20Fulcrum.at('0x14094949152eddbfcd073717200da82fed8dc960'); // mainnet
    const newDAIAmount = BNify(taskArgs.amount).times(BNify(1e18));
    let promises = [
      iDAI.supplyInterestRate.call(),
      iDAI.avgBorrowInterestRate.call(),
      // iDAI.borrowInterestRate.call(),
      iDAI.totalAssetSupply.call(),
      iDAI.totalAssetBorrow.call(),
      iDAI.spreadMultiplier.call(),
      iDAI.nextSupplyInterestRate.call(web3.utils.toBN(newDAIAmount)),
    ];

    const res = await Promise.all(promises);
    let [supplyRate, borrowRate, totalAssetSupply, totalAssetBorrow, spreadMultiplier, autoNextRate] = res;

    supplyRate = BNify(supplyRate);
    borrowRate = BNify(borrowRate);
    totalAssetSupply = BNify(totalAssetSupply);
    totalAssetBorrow = BNify(totalAssetBorrow);
    spreadMultiplier = BNify(spreadMultiplier);
    autoNextRate = BNify(autoNextRate);

    const utilizationRate = BNify(totalAssetBorrow).div(BNify(totalAssetSupply));

    console.log(`CONTRACT FULCRUM current DATA:`);
    console.log(`${BNify(supplyRate).div(1e18).toString()}% supplyRate %`);
    console.log(`${BNify(borrowRate).div(1e18).toString()}% borrowRate %`);
    console.log(`${BNify(totalAssetSupply).div(1e18).toString()} totalAssetSupply DAI`);
    console.log(`${BNify(totalAssetBorrow).div(1e18).toString()} totalAssetBorrow DAI`);
    // console.log(`${spreadMultiplier.toString()} spreadMultiplier`);
    console.log(`${utilizationRate.toString()} utilizationRate`);
    // console.log(`${newDAIAmount.div(1e18).toString()} newDAIAmount`);
    console.log(`${autoNextRate.div(1e18).toString()}% autoNextRate`);
    // console.log(`##############`);

    const a1 = borrowRate;
    const b1 = totalAssetBorrow;
    let s1 = totalAssetSupply;
    const o1 = spreadMultiplier;
    const x1 = newDAIAmount;
    const k1 = BNify('1e20');

    const currentSupplyInterestRate = a1.times(b1.div(s1));
    const targetSupplyRate = a1.times(s1.div(s1.plus(x1))).times(b1.div(s1.plus(x1)))

    const currentSupplyInterestRateWithFee = a1.times(b1.div(s1))
      .times(o1).div(k1); // counting fee (spreadMultiplier)

    // ######
    const targetSupplyRateWithFee = a1.times(s1.div(s1.plus(x1)))
      .times(b1.div(s1.plus(x1)))
      .times(o1).div(k1); // counting fee (spreadMultiplier)

    // q = a * (s / (s + x)) * (b / (s + x))
    // with wolfram for x
    // x = (sqrt(a) sqrt(b) sqrt(s) - sqrt(q) s)/sqrt(q)
    // const maxDAIAmount = a.sqrt().times(b.sqrt()).times(s.sqrt()).minus(q.sqrt().times(s)).div(q.sqrt());
    // q = a * (s / (s + x)) * (b / (s + x)) * o / k
    // with wolfram for x
    // x = (sqrt(a) sqrt(b) sqrt(o) sqrt(s) - sqrt(k) sqrt(q) s)/(sqrt(k) sqrt(q))
    // const maxDAIAmountWithFee = a.sqrt().times(b.sqrt()).times(o.sqrt()).times(s.sqrt()).minus(k.sqrt().times(q.sqrt()).times(s)).div(k.sqrt().times(q.sqrt()));

    console.log(`${currentSupplyInterestRate.div(1e18).toString()} currentSupplyInterestRate`);
    // console.log(`${targetSupplyRate.div(1e18).toString()} targetSupplyRate`);
    console.log(`${currentSupplyInterestRateWithFee.div(1e18).toString()} currentSupplyInterestRateWithFee`);
    console.log(`${targetSupplyRateWithFee.div(1e18).toString()} targetSupplyRateWithFee`);
    console.log(`############ END FULCRUM `);

    const cERC20 = artifacts.require('CERC20');
    const WhitePaperInterestRateModel = artifacts.require('WhitePaperInterestRateModel');

    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const cDAIWithSupply = await ERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const whitePaperInterestModel = await WhitePaperInterestRateModel.at(await cDAI.interestRateModel()); // mainnet

    let promisesComp = [
      cDAI.supplyRatePerBlock.call(),
      cDAI.borrowRatePerBlock.call(),

      cDAI.totalBorrows.call(),
      cDAI.getCash.call(),
      cDAI.totalReserves.call(),
      cDAIWithSupply.totalSupply.call(),
      cDAI.reserveFactorMantissa.call(),
      cDAI.exchangeRateStored.call(),

      // from WhitePaperInterestRateModel
      whitePaperInterestModel.baseRate.call(),
      whitePaperInterestModel.multiplier.call(),
    ];

    const resComp = await Promise.all(promisesComp);
    const [
      contractSupply, contractBorrow,
      totalBorrows, getCash, totalReserves, totalSupply,
      reserveFactorMantissa, exchangeRateStored,
      baseRate, multiplier
    ] = resComp;

    supplyRatePerYear = BNify(contractSupply).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    borrowRatePerYearContract = BNify(contractBorrow).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)

    console.log(`################ CONTRACT DATA COMPOUND`);
    // console.log(`${BNify(borrowRatePerYearContract).div(1e18).toString()}% borrowRatePerYear contract`);
    console.log(`${BNify(totalBorrows).div(1e18).toString()} totalBorrows`)
    console.log(`${BNify(getCash).div(1e18).toString()} getCash`)
    console.log(`${BNify(supplyRatePerYear).div(1e18).toString()}% supplyRatePerYear`);
    // console.log(`${BNify(totalReserves).div(1e18).toString()} totalReserves`)
    // console.log(`${BNify(totalSupply).div(1e8).toString()} totalSupply`)
    // console.log(`${BNify(exchangeRateStored).toString()} exchangeRateStored`)
    // console.log(`${BNify(reserveFactorMantissa).toString()} reserveFactorMantissa`)
    // console.log(`${BNify(baseRate).toString()} baseRate`)
    // console.log(`${BNify(multiplier).toString()} multiplier`)
    // console.log(`################`);

    const a = BNify(baseRate);
    const b = BNify(totalBorrows);
    const c = BNify(multiplier);
    const d = BNify(totalReserves);
    const e = BNify(1e18).minus(BNify(reserveFactorMantissa));
    let s = BNify(getCash);
    // const q = BNify(targetSupplyRate);
    const x = newDAIAmount;
    const k = BNify(2102400); // blocksInAYear
    const j = BNify(1e18); // oneEth
    const f = BNify(100);

    // q = (((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j -> to the block rate
    // q = ((((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j) * k * f -> to get yearly rate -> this is needed

    const targetSupplyRateWithFeeCompound = a.plus(b.times(c).div(b.plus(s).plus(x))).div(k).times(e).times(b).div(
        s.plus(x).plus(b).minus(d)
      ).div(j).times(k).times(f).integerValue(BigNumber.ROUND_FLOOR) // to get the yearly rate

    console.log(`${targetSupplyRateWithFeeCompound.div(1e18).toString()} targetSupplyRateWithFeeCompound per year`);
    // ##### END COMPOUND

    // So ideally we should solve this one and find x1 and x:
    // (a1 * (s1 / (s1 + (n - x))) * (b1 / (s1 + (n - x))) * o1 / k1) - ((((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j) * k * f = 0

    // ###### FULCRUM
    const targetSupplyRateWithFeeFulcrumFoo = x1 => a1.times(s1.div(s1.plus(x1)))
      .times(b1.div(s1.plus(x1)))
      .times(o1).div(k1); // counting fee (spreadMultiplier)

    const maxDAIFulcrumFoo = q1 =>
      a1.sqrt().times(b1.sqrt()).times(o1.sqrt()).times(s1.sqrt()).minus(k1.sqrt().times(q1.sqrt()).times(s1)).div(k1.sqrt().times(q1.sqrt()));

    // ###### COMPOUND
    const targetSupplyRateWithFeeCompoundFoo = x => a.plus(b.times(c).div(b.plus(s).plus(x))).div(k).times(e).times(b).div(
        s.plus(x).plus(b).minus(d)
      ).div(j).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR);

    const maxDAICompoundFoo = q =>
      a.pow(2).times(b.pow(2)).times(e.pow(2)).times(f.pow(2)).plus(
        BNify('2').times(a).times(b).times(d).times(e).times(f).times(j).times(q).plus(
          BNify('4').times(b.pow(2)).times(c).times(e).times(j).times(f).times(q).plus(
            d.pow(2).times(j.pow(2)).times(q.pow(2))
          )
        )
      ).sqrt().plus(
        a.times(b).times(e).times(f)
      ).minus(BNify('2').times(b).times(j).times(q)).plus(
        d.times(j).times(q)
      ).minus(
        BNify('2').times(j).times(q).times(s)
      ).div(BNify('2').times(j).times(q));

    const algo = (amount, currBestTokenAddr, bestRate, worstRate) => {
      const isCompoundBest = currBestTokenAddr === cDAI.address;
      let maxDAICompound;
      let maxDAIFulcrum;
      amount = BNify(amount);

      // Check if all the amount could be deposited in the protocol with
      // the current best rate otherwise calculate the maxAmountBelow the worstRate
      if (isCompoundBest) {
        console.log('Trying to make all on compound')
        if (targetSupplyRateWithFeeCompoundFoo(amount).gt(worstRate)) {
          // All on Compound
          return [amount, BNify(0)];
        } else {
          maxDAICompound = maxDAICompoundFoo(worstRate);
          // add maxDAIFulcrum to s
          s = s.plus(maxDAICompound); // totalSupplyAvailable compound
          amount = amount.minus(maxDAICompound);
          console.log(`${maxDAICompound && maxDAICompound.div(1e18)} maxDAICompound`);
        }
      } else {
        console.log('Trying to make all on fulcrum')
        if (targetSupplyRateWithFeeFulcrumFoo(amount).gt(worstRate)) {
          console.log('all on fulcrum')
          // All on Fulcrum
          return [BNify(0), amount];
        } else {
          // add maxDAIFulcrum to s1
          maxDAIFulcrum = maxDAIFulcrumFoo(worstRate);
          s1 = s1.plus(maxDAIFulcrum); // totalSupplyAvailable fulcrum
          amount = amount.minus(maxDAIFulcrum);
          console.log(`${maxDAIFulcrum && maxDAIFulcrum.div(1e18)} maxDAIFulcrum`);
        }
      }

      // TODO check this
      const amountFulcrum = amount.times(s1.div(s1.plus(s)));
      const amountCompound = amount.minus(amountFulcrum);
      // const halfAmount = amount.div(BNify('2'));

      const tolerance = BNify('0.1').times(BNify('1e18')); // 0.1%
      let i = 0;
      const amountSizesCalcRec = (
        // compoundAmount = halfAmount,
        // fulcrumAmount = halfAmount,
        compoundAmount = amountCompound,
        fulcrumAmount = amountFulcrum,
        isCurrCompoundBest = isCompoundBest) => {
        console.log(++i);

        const fulcNewRate = targetSupplyRateWithFeeFulcrumFoo(fulcrumAmount);
        const compNewRate = targetSupplyRateWithFeeCompoundFoo(compoundAmount);
        const isCompoundNewBest = compNewRate.gt(fulcNewRate);

        let newCompoundAmount;
        let newFulcrumAmount;
        let smallerAmount;

        console.log('DATA ######')
        console.log({
          fulcrumAmount: fulcrumAmount.div(1e18).toString(),
          compoundAmount: compoundAmount.div(1e18).toString(),
          fulcNewRate: fulcNewRate.div(1e18).toString(),
          compNewRate: compNewRate.div(1e18).toString(),
        });

        smallerAmount = fulcrumAmount.gt(compoundAmount) ? compoundAmount : fulcrumAmount;

        if (fulcNewRate.plus(tolerance).gt(compNewRate) && fulcNewRate.lt(compNewRate) ||
            (compNewRate.plus(tolerance).gt(fulcNewRate) && compNewRate.lt(fulcNewRate))) {
          return [compoundAmount, fulcrumAmount];
        }

        if (isCompoundNewBest) {
          // Compound > Fulcrum
          newFulcrumAmount = fulcrumAmount.minus(smallerAmount.div(BNify('2')));
          newCompoundAmount = compoundAmount.plus(smallerAmount.div(BNify('2')))
        } else {
          newCompoundAmount = compoundAmount.minus(smallerAmount.div(BNify('2')));
          newFulcrumAmount = fulcrumAmount.plus(smallerAmount.div(BNify('2')));
        }

        return amountSizesCalcRec(newCompoundAmount, newFulcrumAmount, isCompoundNewBest);
      };

      let [compAmount, fulcAmount] = amountSizesCalcRec();
      if (maxDAIFulcrum) {
        // add maxDAIFulcrum to s1
        fulcAmount = fulcAmount.plus(maxDAIFulcrum);
      }
      if (maxDAICompound) {
        // add maxDAIFulcrum to s
        compAmount = compAmount.plus(maxDAICompound);
      }

      return [compAmount, fulcAmount];
    };

    const fulcrumCurr = targetSupplyRateWithFeeFulcrumFoo(0);
    const compoundCurr = targetSupplyRateWithFeeCompoundFoo(0);
    const currBestAddress = fulcrumCurr.gt(compoundCurr) ? iDAI.address : cDAI.address;
    const bestRate = fulcrumCurr.gt(compoundCurr) ? fulcrumCurr : compoundCurr;
    const worstRate = fulcrumCurr.gt(compoundCurr) ? compoundCurr : fulcrumCurr;

    const resAlgo = algo(newDAIAmount, currBestAddress, bestRate, worstRate);
    console.log(`${resAlgo[0].div(1e18).toString()} DAI in compound, ${resAlgo[1].div(1e18).toString()} DAI fulcrum ####################`);
  });

task("idleDAI:rebalanceCalcNewton", "idleDAI rebalance calculations with newtonRaphson algo")
  .addParam("amount", "The amount provided, eg '100000' for 100000 DAI ")
  .setAction(async taskArgs => {
    const ERC20 = artifacts.require('ERC20');
    const iERC20Fulcrum = artifacts.require('iERC20Fulcrum');
    const iDAI = await iERC20Fulcrum.at('0x14094949152eddbfcd073717200da82fed8dc960'); // mainnet
    let promises = [
      iDAI.supplyInterestRate.call(),
      iDAI.avgBorrowInterestRate.call(),
      iDAI.totalAssetSupply.call(),
      iDAI.totalAssetBorrow.call(),
      iDAI.spreadMultiplier.call(),
    ];

    const res = await Promise.all(promises);
    let [supplyRate, borrowRate, totalAssetSupply, totalAssetBorrow, spreadMultiplier] = res;

    supplyRate = BNify(supplyRate);
    borrowRate = BNify(borrowRate);
    totalAssetSupply = BNify(totalAssetSupply);
    totalAssetBorrow = BNify(totalAssetBorrow);
    spreadMultiplier = BNify(spreadMultiplier);

    const newDAIAmount = BNify(taskArgs.amount).times(BNify(1e18));
    const utilizationRate = BNify(totalAssetBorrow).div(BNify(totalAssetSupply));

    console.log(`CONTRACT FULCRUM current DATA:`);
    // console.log(`${BNify(supplyRate).div(1e18).toString()}% supplyRate %`);
    // console.log(`${BNify(borrowRate).div(1e18).toString()}% borrowRate %`);
    console.log(`${BNify(totalAssetSupply).div(1e18).toString()} totalAssetSupply DAI`);
    console.log(`${BNify(totalAssetBorrow).div(1e18).toString()} totalAssetBorrow DAI`);
    // console.log(`${spreadMultiplier.toString()} spreadMultiplier`);
    console.log(`${utilizationRate.toString()} utilizationRate`);
    // console.log(`${newDAIAmount.div(1e18).toString()} newDAIAmount`);
    // console.log(`##############`);

    const a1 = borrowRate;
    const b1 = totalAssetBorrow;
    let s1 = totalAssetSupply;
    const o1 = spreadMultiplier;
    const x1 = newDAIAmount;
    const k1 = BNify('1e20');

    const currentSupplyInterestRate = a1.times(b1.div(s1));
    const targetSupplyRate = a1.times(s1.div(s1.plus(x1))).times(b1.div(s1.plus(x1)))

    const currentSupplyInterestRateWithFee = a1.times(b1.div(s1))
      .times(o1).div(k1); // counting fee (spreadMultiplier)

    // ######
    const targetSupplyRateWithFee = a1.times(s1.div(s1.plus(x1)))
      .times(b1.div(s1.plus(x1)))
      .times(o1).div(k1); // counting fee (spreadMultiplier)

    // q = a * (s / (s + x)) * (b / (s + x))
    // with wolfram for x
    // x = (sqrt(a) sqrt(b) sqrt(s) - sqrt(q) s)/sqrt(q)
    // const maxDAIAmount = a.sqrt().times(b.sqrt()).times(s.sqrt()).minus(q.sqrt().times(s)).div(q.sqrt());
    // q = a * (s / (s + x)) * (b / (s + x)) * o / k
    // with wolfram for x
    // x = (sqrt(a) sqrt(b) sqrt(o) sqrt(s) - sqrt(k) sqrt(q) s)/(sqrt(k) sqrt(q))
    // const maxDAIAmountWithFee = a.sqrt().times(b.sqrt()).times(o.sqrt()).times(s.sqrt()).minus(k.sqrt().times(q.sqrt()).times(s)).div(k.sqrt().times(q.sqrt()));

    // console.log(`${currentSupplyInterestRate.div(1e18).toString()} currentSupplyInterestRate`);
    // console.log(`${targetSupplyRate.div(1e18).toString()} targetSupplyRate`);
    console.log(`${currentSupplyInterestRateWithFee.div(1e18).toString()} currentSupplyInterestRateWithFee`);
    console.log(`${targetSupplyRateWithFee.div(1e18).toString()} targetSupplyRateWithFee`);
    console.log(`############ END FULCRUM `);

    const cERC20 = artifacts.require('CERC20');
    const WhitePaperInterestRateModel = artifacts.require('WhitePaperInterestRateModel');

    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const cDAIWithSupply = await ERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const whitePaperInterestModel = await WhitePaperInterestRateModel.at(await cDAI.interestRateModel.call()); // mainnet

    let promisesComp = [
      cDAI.supplyRatePerBlock.call(),
      cDAI.borrowRatePerBlock.call(),

      cDAI.totalBorrows.call(),
      cDAI.getCash.call(),
      cDAI.totalReserves.call(),
      cDAIWithSupply.totalSupply.call(),
      cDAI.reserveFactorMantissa.call(),
      cDAI.exchangeRateStored.call(),

      // from WhitePaperInterestRateModel
      whitePaperInterestModel.baseRate.call(),
      whitePaperInterestModel.multiplier.call(),
    ];

    const resComp = await Promise.all(promisesComp);
    const [
      contractSupply, contractBorrow,
      totalBorrows, getCash, totalReserves, totalSupply,
      reserveFactorMantissa, exchangeRateStored,
      baseRate, multiplier
    ] = resComp;

    supplyRatePerYear = BNify(contractSupply).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    borrowRatePerYearContract = BNify(contractBorrow).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)

    console.log(`################ CONTRACT DATA COMPOUND`);
    // console.log(`${BNify(borrowRatePerYearContract).div(1e18).toString()}% borrowRatePerYear contract`);
    console.log(`${BNify(totalBorrows).div(1e18).toString()} totalBorrows`)
    console.log(`${BNify(getCash).div(1e18).toString()} getCash`)
    console.log(`${BNify(supplyRatePerYear).div(1e18).toString()}% supplyRatePerYear`);
    // console.log(`${BNify(totalReserves).div(1e18).toString()} totalReserves`)
    // console.log(`${BNify(totalSupply).div(1e8).toString()} totalSupply`)
    // console.log(`${BNify(exchangeRateStored).toString()} exchangeRateStored`)
    // console.log(`${BNify(reserveFactorMantissa).toString()} reserveFactorMantissa`)
    // console.log(`${BNify(baseRate).toString()} baseRate`)
    // console.log(`${BNify(multiplier).toString()} multiplier`)
    // console.log(`################`);

    const a = BNify(baseRate);
    const b = BNify(totalBorrows);
    const c = BNify(multiplier);
    const d = BNify(totalReserves);
    const e = BNify(1e18).minus(BNify(reserveFactorMantissa));
    let s = BNify(getCash);
    // const q = BNify(targetSupplyRate);
    const x = newDAIAmount;
    const k = BNify(2102400); // blocksInAYear
    const j = BNify(1e18); // oneEth
    const f = BNify(100);

    // q = (((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j -> to the block rate
    // q = ((((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j) * k * f -> to get yearly rate -> this is needed

    const targetSupplyRateWithFeeCompound = a.plus(b.times(c).div(b.plus(s).plus(x))).div(k).times(e).times(b).div(
        s.plus(x).plus(b).minus(d)
      ).div(j).times(k).times(f).integerValue(BigNumber.ROUND_FLOOR) // to get the yearly rate

    console.log(`${targetSupplyRateWithFeeCompound.div(1e18).toString()} targetSupplyRateWithFeeCompound per year`);
    // ##### END COMPOUND

    // So ideally we should solve this one and find x1 and x:
    // (a1 * (s1 / (s1 + (n - x))) * (b1 / (s1 + (n - x))) * o1 / k1) - ((((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j) * k * f = 0

    // ###### FULCRUM
    const targetSupplyRateWithFeeFulcrumFoo = x1 => a1.times(s1.div(s1.plus(x1)))
      .times(b1.div(s1.plus(x1)))
      .times(o1).div(k1); // counting fee (spreadMultiplier)

    // const maxDAIFulcrumFoo = q1 =>
    //   a1.sqrt().times(b1.sqrt()).times(o1.sqrt()).times(s1.sqrt()).minus(k1.sqrt().times(q1.sqrt()).times(s1)).div(k1.sqrt().times(q1.sqrt()));

    // ###### COMPOUND
    const targetSupplyRateWithFeeCompoundFoo = x => a.plus(b.times(c).div(b.plus(s).plus(x))).div(k).times(e).times(b).div(
        s.plus(x).plus(b).minus(d)
      ).div(j).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR);

    // const maxDAICompoundFoo = q =>
    //   a.pow(2).times(b.pow(2)).times(e.pow(2)).times(f.pow(2)).plus(
    //     BNify('2').times(a).times(b).times(d).times(e).times(f).times(j).times(q).plus(
    //       BNify('4').times(b.pow(2)).times(c).times(e).times(j).times(f).times(q).plus(
    //         d.pow(2).times(j.pow(2)).times(q.pow(2))
    //       )
    //     )
    //   ).sqrt().plus(
    //     a.times(b).times(e).times(f)
    //   ).minus(BNify('2').times(b).times(j).times(q)).plus(
    //     d.times(j).times(q)
    //   ).minus(
    //     BNify('2').times(j).times(q).times(s)
    //   ).div(BNify('2').times(j).times(q));

    const fulcrumCurr = targetSupplyRateWithFeeFulcrumFoo(0);
    const compoundCurr = targetSupplyRateWithFeeCompoundFoo(0);

    console.log(`compound curr ${compoundCurr.div(1e18)}%, Fulcrum curr: ${fulcrumCurr.div(1e18)}%`);
    const currBestAddress = fulcrumCurr.gt(compoundCurr) ? iDAI.address : cDAI.address;
    const bestRate = fulcrumCurr.gt(compoundCurr) ? fulcrumCurr : compoundCurr;
    const worstRate = fulcrumCurr.gt(compoundCurr) ? compoundCurr : fulcrumCurr;

    const n = newDAIAmount;
    const fx = x => a1.times(s1.div(s1.plus(n.minus(x))))
      .times(b1.div(s1.plus(n.minus(x))))
      .times(o1).div(k1)
      .minus(
        a.plus(b.times(c).div(b.plus(s).plus(x))).div(k).times(e).times(b).div(
          s.plus(x).plus(b).minus(d)
        ).div(j).times('2102400').times('100')
      ).integerValue(BigNumber.ROUND_FLOOR);

    // f'(x) = (b e f (a + (b c)/(b + s + x)))/(j (b - d + s + x)^2) + (2 a1 b1 o1 s1)/(k1 * (n + s1 - x)^3) + (b^2 c e f)/(j (b + s + x)^2 (b - d + s + x))
    const f1x = x => b.times(e).times(f).times(
      a.plus(b.times(c).div(b.plus(s).plus(x)))
    ).div(j.times((b.minus(d).plus(s).plus(x)).pow(2))).plus(
      BNify('2').times(a1).times(b1).times(o1).times(s1).div(
        k1.times((n.plus(s1).minus(x)).pow(3))
      )
    ).plus(
      b.pow(2).times(c).times(e).times(f).div(
        j.times((b.plus(s).plus(x)).pow(2)).times(b.minus(d).plus(s).plus(x))
      )
    );

    // const perc = BNify(0.1).times(1e18); // 0.1%
    const perc = BNify(0.1); // 0.1%
    const maxIteration = 20;
    console.log(`n = ${n.div(1e18)}`)
    const newtonRaphson = (func, funcDerivative, x_0, maxIter = maxIteration, limitPerc = perc) => {
      let iter = 0;
      while (iter++ < maxIter) {
        const y = func(x_0);
        const yp = funcDerivative(x_0);
        // Update the guess:
        const x_1 = x_0.minus(y.div(yp));
        // Check for convergence:
        console.log(`iteration: ${iter} #######`);
        console.log(`${x_0} x_0`)
        console.log(`${x_1} x_1`)
        console.log(`${y} y`)
        console.log(`${y.div(1e18)} y.div(1e18)`)
        console.log(`${yp} yp`)
        // if (targetSupplyRateWithFeeCompoundFoo(x_0).minus(targetSupplyRateWithFeeFulcrumFoo(n.minus(x_0))).abs().lte(BNify(limitPerc).times(1e18))) {
        // if (x_1.minus(x_0).abs().lte(limitPerc.times(x_1.abs()))) {
        if (y.div(1e18).abs().lte(limitPerc)) {
          console.log('Newton-Raphson: converged to x = ' + x_1.div(1e18) + ' after ' + iter + ' iterations');
          return x_1;
        }

        // Transfer update to the new guess:
        x_0 = x_1;
      }
      console.log('Newton-Raphson: Maximum iterations reached (' + maxIter + ')');
      return false;
    };

    const amountFulcrum = n.times(s1.div(s1.plus(s)));
    const amountCompound = n.minus(amountFulcrum);
    console.log(`Initial Guess (Compound) = ${amountCompound.div(1e18)} DAI`)
    // const resAlgo = newtonRaphson(fx, f1x, n.div(2));
    const resAlgo = newtonRaphson(fx, f1x, amountCompound); // correct one
    // const resAlgo = newtonRaphson(fx, f1x, BNify(1e-7));
    console.log(`${resAlgo.div(1e18).toString()} DAI in compound, ${n.div(1e18).minus(resAlgo.div(1e18)).toString()} DAI fulcrum ####################`);
    console.log(`${targetSupplyRateWithFeeCompoundFoo(resAlgo).div(1e18).toString()}% target in compound, ${targetSupplyRateWithFeeFulcrumFoo(n.minus(resAlgo)).div(1e18).toString()}% target rate fulcrum ####################`);
  });

task("cDAI:nextRateData", "cDAI calculate next supplyRate")
  .setAction(async taskArgs => {
    const cERC20 = artifacts.require('CERC20');
    const ERC20 = artifacts.require('ERC20');
    const WhitePaperInterestRateModel = artifacts.require('WhitePaperInterestRateModel');

    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const cDAIWithSupply = await ERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const whitePaperInterestModel = await WhitePaperInterestRateModel.at(await cDAI.interestRateModel()); // mainnet

    let promises = [
      whitePaperInterestModel.getBorrowRate.call(
        await cDAI.getCash.call(),
        await cDAI.totalBorrows.call(),
        BNify(0)
      ),
      cDAI.supplyRatePerBlock.call(),
      cDAI.borrowRatePerBlock.call(),

      cDAI.totalBorrows.call(),
      cDAI.getCash.call(),
      cDAI.totalReserves.call(),
      cDAIWithSupply.totalSupply.call(),
      cDAI.reserveFactorMantissa.call(),
    ];

    const res = await Promise.all(promises);
    const [whiteBorrow, contractSupply, contractBorrow, totalBorrows, getCash, totalReserves, totalSupply, reserveFactorMantissa] = res;

    borrowRatePerYear = BNify(whiteBorrow[1]).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    supplyRatePerYear = BNify(contractSupply).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    borrowRatePerYearContract = BNify(contractBorrow).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)

    console.log(`${whiteBorrow[1].toString()} borrow whitepaper`);
    console.log(`${contractSupply.toString()} contract supply`);
    console.log(`${contractBorrow.toString()} contract borrow`);
    console.log(`################`);
    console.log(`${BNify(borrowRatePerYear).div(1e18).toString()}% borrowRatePerYear white`);
    console.log(`${BNify(borrowRatePerYearContract).div(1e18).toString()}% borrowRatePerYear contract`);
    console.log(`${BNify(supplyRatePerYear).div(1e18).toString()}% supplyRatePerYear`);
    console.log(`################`);
    console.log(`${BNify(totalBorrows).div(1e18).toString()} totalBorrows`)
    console.log(`${BNify(getCash).div(1e18).toString()} getCash`)
    console.log(`${BNify(totalReserves).div(1e18).toString()} totalReserves`)
    console.log(`${BNify(totalSupply).div(1e8).toString()} totalSupply`)
    console.log(`${BNify(reserveFactorMantissa).toString()} reserveFactorMantissa`)
    console.log(`################`);

    const rate = BNify(getCash).plus(BNify(totalBorrows)).minus(BNify(totalReserves)).div(BNify(totalSupply)).times(1e18);
    console.log(`${BNify(rate).toString()} rate`);

    const underlying = BNify(totalSupply).times(rate.div(1e18));
    console.log(`${BNify(underlying).toString()} underlying`);
    const borrowsPer = BNify(totalBorrows).div(underlying);
    console.log(`${BNify(borrowsPer).toString()} borrowsPer`);
    const borrowRate = whiteBorrow[1];
    console.log(`${BNify(borrowRate).toString()} borrowRate`);

    const oneMinusReserveFactor = BNify(1e18).minus(reserveFactorMantissa);
    console.log(`${BNify(oneMinusReserveFactor).toString()} oneMinusReserveFactor`);

    const supplyRate = BNify(borrowRate).times(oneMinusReserveFactor).times(borrowsPer).div(1e18);
    console.log(`${BNify(supplyRate).toString()} supplyRate`);

    const newSupplyRatePerYear = BNify(supplyRate).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    console.log(`${BNify(newSupplyRatePerYear).div(1e18).toString()}% newSupplyRatePerYear`);
  });

task("cDAI:nextRateDataWithAmount", "cDAI calculate next supplyRate given a supplyAmount")
  .addParam("amount", "The amount provided, eg '100000' for 100000 DAI ")
  .setAction(async taskArgs => {
    const cERC20 = artifacts.require('CERC20');
    const ERC20 = artifacts.require('ERC20');
    const WhitePaperInterestRateModel = artifacts.require('WhitePaperInterestRateModel');

    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const cDAIWithSupply = await ERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const whitePaperInterestModel = await WhitePaperInterestRateModel.at(await cDAI.interestRateModel()); // mainnet


    // First calculate what the new borrowRate would be
    const newDAIAmount = BNify(taskArgs.amount).times(1e18);
    const getCashPre = await cDAI.getCash.call();
    const amount = BNify(getCashPre.toString()).plus(newDAIAmount);
    const totalBorrowsPre = await cDAI.totalBorrows.call();

    const whiteBorrow = await whitePaperInterestModel.getBorrowRate.call(
      web3.utils.toBN(amount),
      totalBorrowsPre,
      BNify(0)
    );

    let promises = [
      // whitePaperInterestModel.getBorrowRate.call(
      //   await cDAI.getCash.call(),
      //   await cDAI.totalBorrows.call(),
      //   BNify(0)
      // ),
      cDAI.supplyRatePerBlock.call(),
      cDAI.borrowRatePerBlock.call(),
      cDAI.totalBorrows.call(),
      cDAI.getCash.call(),
      cDAI.totalReserves.call(),
      cDAIWithSupply.totalSupply.call(),
      cDAI.reserveFactorMantissa.call(),
      cDAI.exchangeRateStored.call(),
    ];

    const res = await Promise.all(promises);

    // TODO remove
    // const [whiteBorrow, contractSupply, contractBorrow, totalBorrows, getCash, totalReserves, totalSupply, reserveFactorMantissa, exchangeRateStored] = res;
    const [contractSupply, contractBorrow, totalBorrows, getCash, totalReserves, totalSupply, reserveFactorMantissa, exchangeRateStored] = res;

    borrowRatePerYear = BNify(whiteBorrow[1]).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    supplyRatePerYear = BNify(contractSupply).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    borrowRatePerYearContract = BNify(contractBorrow).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)

    console.log(`${whiteBorrow[1].toString()} borrow whitepaper`);
    console.log(`${contractSupply.toString()} contract supply`);
    console.log(`${contractBorrow.toString()} contract borrow`);
    console.log(`################`);
    console.log(`${BNify(borrowRatePerYear).div(1e18).toString()}% borrowRatePerYear white`);
    console.log(`${BNify(borrowRatePerYearContract).div(1e18).toString()}% borrowRatePerYear contract`);
    console.log(`${BNify(supplyRatePerYear).div(1e18).toString()}% supplyRatePerYear`);
    console.log(`################`);
    console.log(`${BNify(totalBorrows).div(1e18).toString()} totalBorrows`)
    console.log(`${BNify(getCash).div(1e18).toString()} getCash`)
    console.log(`${BNify(totalReserves).div(1e18).toString()} totalReserves`)
    console.log(`${BNify(totalSupply).div(1e8).toString()} totalSupply`)
    console.log(`${BNify(reserveFactorMantissa).toString()} reserveFactorMantissa`)
    console.log(`${BNify(exchangeRateStored).toString()} exchangeRateStored`)
    console.log(`################`);

    // Calc updated getCash (DAI) and totalSupply (cDAI)
    const newCash = BNify(getCash).plus(newDAIAmount);
    const newCDAI = newDAIAmount.times(1e18).div(exchangeRateStored).div(1e8);
    console.log(`${BNify(newCDAI).toString()} newCDAI`);
    const newSupply = BNify(totalSupply).plus(newCDAI);

    // Calc new exchangeRate
    const rate = BNify(newCash).plus(BNify(totalBorrows)).minus(BNify(totalReserves)).div(BNify(newSupply)).times(1e18);
    console.log(`${BNify(rate).toString()} rate`);

    const underlying = BNify(newSupply).times(rate.div(1e18));
    console.log(`${BNify(underlying).toString()} underlying`);
    const borrowsPer = BNify(totalBorrows).div(underlying);
    console.log(`${BNify(borrowsPer).toString()} borrowsPer`);
    const borrowRate = whiteBorrow[1];
    console.log(`${BNify(borrowRate).toString()} borrowRate`);

    const oneMinusReserveFactor = BNify(1e18).minus(reserveFactorMantissa);
    console.log(`${BNify(oneMinusReserveFactor).toString()} oneMinusReserveFactor`);

    const supplyRate = BNify(borrowRate).times(oneMinusReserveFactor).times(borrowsPer).div(1e18);
    console.log(`${BNify(supplyRate).toString()} supplyRate`);

    const newSupplyRatePerYear = BNify(supplyRate).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    console.log(`${BNify(newSupplyRatePerYear).div(1e18).toString()}% newSupplyRatePerYear`);
  });

task("cDAI:amountToRate", "cDAI calculate max amount lendable with a min target supply rate")
  .addParam("rate", "The target rate, eg '8' for 8% ")
  .setAction(async taskArgs => {
    const cERC20 = artifacts.require('CERC20');
    const ERC20 = artifacts.require('ERC20');
    const WhitePaperInterestRateModel = artifacts.require('WhitePaperInterestRateModel');

    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const cDAIWithSupply = await ERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    const whitePaperInterestModel = await WhitePaperInterestRateModel.at(await cDAI.interestRateModel()); // mainnet

    let promises = [
      cDAI.supplyRatePerBlock.call(),
      cDAI.borrowRatePerBlock.call(),

      cDAI.totalBorrows.call(),
      cDAI.getCash.call(),
      cDAI.totalReserves.call(),
      cDAIWithSupply.totalSupply.call(),
      cDAI.reserveFactorMantissa.call(),
      cDAI.exchangeRateStored.call(),

      // from WhitePaperInterestRateModel
      whitePaperInterestModel.baseRate.call(),
      whitePaperInterestModel.multiplier.call(),
    ];

    const res = await Promise.all(promises);
    const [
      contractSupply, contractBorrow,
      totalBorrows, getCash, totalReserves, totalSupply,
      reserveFactorMantissa, exchangeRateStored,
      baseRate, multiplier
    ] = res;

    supplyRatePerYear = BNify(contractSupply).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    borrowRatePerYearContract = BNify(contractBorrow).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)

    console.log(`${contractSupply.toString()} contract supply`);
    console.log(`${contractBorrow.toString()} contract borrow`);
    console.log(`################`);
    console.log(`${BNify(borrowRatePerYearContract).div(1e18).toString()}% borrowRatePerYear contract`);
    console.log(`${BNify(supplyRatePerYear).div(1e18).toString()}% supplyRatePerYear`);
    console.log(`################`);
    console.log(`${BNify(totalBorrows).div(1e18).toString()} totalBorrows`)
    console.log(`${BNify(getCash).div(1e18).toString()} getCash`)
    console.log(`${BNify(totalReserves).div(1e18).toString()} totalReserves`)
    console.log(`${BNify(totalSupply).div(1e8).toString()} totalSupply`)
    console.log(`${BNify(exchangeRateStored).toString()} exchangeRateStored`)
    console.log(`${BNify(reserveFactorMantissa).toString()} reserveFactorMantissa`)
    console.log(`################`);
    console.log(`${BNify(baseRate).toString()} baseRate`)
    console.log(`${BNify(multiplier).toString()} multiplier`)

    const targetSupplyRatePerYear = BNify(taskArgs.rate).times(1e18);
    const targetSupplyRate = targetSupplyRatePerYear.div(BNify('2102400').times(BNify('100')));

    const a = BNify(baseRate);
    const b = BNify(totalBorrows);
    const c = BNify(multiplier);
    const d = BNify(totalReserves);
    const e = BNify(1e18).minus(BNify(reserveFactorMantissa));
    const s = BNify(getCash);
    let q = BNify(targetSupplyRate);
    const k = BNify(2102400); // blocksInAYear
    const j = BNify(1e18); // oneEth
    const f = BNify(100);

    // const manualRate = a.plus(b.times(c).div(b.plus(s).plus(x))).div(BNify(2102400)).times(e).times(
    //   b.div(s.plus(x).plus(b).minus(d))
    // ).div(1e18).integerValue(BigNumber.ROUND_FLOOR);

    // q = (a + (b*c)/(b + s + x)) * 0.9 * b / (s + x + b - d)

    // q = (((a + (b*c)/(b + s + x)) / k) * e * b / (s + x + b - d)) / j

    // sqrt(a^2 b^2 e^2 + 2 a b d e j k q + 4 b^2 c e j k q + d^2 j^2 k^2 q^2) + a b e - 2 b j k q + d j k q - 2 j k q s)/(2 j k q)

    const newDAIAmountWithRatePerBlock =
      a.pow(2).times(b.pow(2)).times(e.pow(2)).plus(
        BNify('2').times(a).times(b).times(d).times(e).times(j).times(k).times(q).plus(
          BNify('4').times(b.pow(2)).times(c).times(e).times(j).times(k).times(q).plus(
            d.pow(2).times(j.pow(2)).times(k.pow(2)).times(q.pow(2))
          )
        )
      ).sqrt().plus(
        a.times(b).times(e)
      ).minus(BNify('2').times(b).times(j).times(k).times(q)).plus(
        d.times(j).times(k).times(q)
      ).minus(
        BNify('2').times(j).times(k).times(q).times(s)
      ).div(BNify('2').times(j).times(k).times(q));

    // (sqrt(a^2 b^2 e^2 f^2 + 2 a b d e f j q + 4 b^2 c e f j q + d^2 j^2 q^2) + a b e f - 2 b j q + d j q - 2 j q s)/(2 j q)
    q = targetSupplyRatePerYear;
    const newDAIAmountWithRatePerYear =
      a.pow(2).times(b.pow(2)).times(e.pow(2)).times(f.pow(2)).plus(
        BNify('2').times(a).times(b).times(d).times(e).times(f).times(j).times(q).plus(
          BNify('4').times(b.pow(2)).times(c).times(e).times(j).times(f).times(q).plus(
            d.pow(2).times(j.pow(2)).times(q.pow(2))
          )
        )
      ).sqrt().plus(
        a.times(b).times(e).times(f)
      ).minus(BNify('2').times(b).times(j).times(q)).plus(
        d.times(j).times(q)
      ).minus(
        BNify('2').times(j).times(q).times(s)
      ).div(BNify('2').times(j).times(q));

    console.log(`@@@@@ ${BNify(newDAIAmountWithRatePerBlock).toString()} newDAIAmountWithRatePerBlock`);
    console.log(`@@@@@ ${BNify(newDAIAmountWithRatePerBlock).div(1e18).toString()} newDAIAmountWithRatePerBlock`);

    console.log(`@@@@@ ${BNify(newDAIAmountWithRatePerYear).div(1e18).toString()} newDAIAmountWithRatePerYear`);
  });

task("cDAI:apr", "Get cDAI APR")
  .setAction(async taskArgs => {
    const cERC20 = artifacts.require('CERC20');
    const cDAI = await cERC20.at('0xf5dce57282a584d2746faf1593d3121fcac444dc'); // mainnet
    let res = await cDAI.supplyRatePerBlock.call();

    res = BNify(res).times('2102400').times('100').integerValue(BigNumber.ROUND_FLOOR)
    console.log(`RES: ${res.div(1e18).toString()}`)
  });

module.exports = {
  version: '0.5.2',
  paths: {
    artifacts: "./build/contracts"
  },
  networks: {
    develop: {
      url: `https://mainnet.infura.io/v3/${INFURA_KEY}`
    }
  }
};